import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getDb, type Queryable } from "./db";
import { privateHash } from "./session";
import type { EventRow } from "./event";

const scrypt = promisify(scryptCallback);
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";
const codeHash = (code: string) => createHash("sha256").update(code.trim()).digest("hex");
const normalizeReference = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const normalizeUsername = (value: string) => value.trim().toLowerCase();

async function passwordDigest(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
async function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function audit(tx: Queryable, eventId: string, accountId: string | null, type: string, reasonCode: string, metadata: Record<string, unknown> = {}) {
  await tx.query(
    "INSERT INTO audit_events (id,event_id,account_id,type,reason_code,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [randomUUID(), eventId, accountId, type, reasonCode, JSON.stringify(metadata)],
  );
}

export async function createProtectedEvent(sourceEventId: string, key: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const source = (await tx.query<EventRow>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [sourceEventId])).rows[0];
    if (!source) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    const prior = (await tx.query<{ response_body: unknown }>(
      "SELECT response_body FROM idempotency_records WHERE event_id=$1 AND account_id=$2 AND operation='CREATE_PROTECTED_EVENT' AND key=$3",
      [sourceEventId, ORGANIZER_ID, key],
    )).rows[0];
    if (prior) return typeof prior.response_body === "string" ? JSON.parse(prior.response_body) : prior.response_body;
    const id = randomUUID();
    await tx.query(
      `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold,batch_size,reservation_ttl_seconds,admission_ttl_seconds,queue_policy_version,access_mode)
       VALUES ($1,'Protected Fair Drop demo','ENTRY_OPEN',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '24 hours',$2,$2,0,0,$3,$4,$5,$6,'PROTECTED')`,
      [id, source.total_inventory, source.batch_size, source.reservation_ttl_seconds, source.admission_ttl_seconds, source.queue_policy_version],
    );
    const result = { ok: true, reasonCode: "PROTECTED_EVENT_CREATED", eventId: id, buyerUrl: `/protected/${id}` };
    await tx.query(
      "INSERT INTO idempotency_records (event_id,account_id,operation,key,request_hash,response_status,response_body) VALUES ($1,$2,'CREATE_PROTECTED_EVENT',$3,$4,200,$5::jsonb)",
      [sourceEventId, ORGANIZER_ID, key, createHash("sha256").update(sourceEventId).digest("hex"), JSON.stringify(result)],
    );
    await audit(tx, id, ORGANIZER_ID, "PROTECTED_EVENT_CREATED", "INVITATION_MODE", { sourceEventId });
    return result;
  });
}

export async function issueInvitation(eventId: string, reference: string, label: string) {
  const normalized = normalizeReference(reference);
  const cleanLabel = label.trim();
  if (normalized.length < 3 || normalized.length > 120 || cleanLabel.length < 2 || cleanLabel.length > 80) {
    return { ok: false, reasonCode: "INVALID_ATTENDEE", message: "Use a 3–120 character attendee reference and a 2–80 character label." };
  }
  const referenceHash = await privateHash(`person:${eventId}:${normalized}`);
  const code = `FD-${randomBytes(18).toString("base64url")}`;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = (await tx.query<EventRow>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [eventId])).rows[0];
    if (!event || event.access_mode !== "PROTECTED") return { ok: false, reasonCode: "PROTECTED_EVENT_REQUIRED", message: "Protected event not found." };
    if (event.status !== "ENTRY_OPEN") return { ok: false, reasonCode: "ENTRY_CLOSED", message: "Invitation issuing has closed." };
    let person = (await tx.query<{ id: string; label: string }>(
      "SELECT id,label FROM protected_people WHERE event_id=$1 AND reference_hash=$2 FOR UPDATE", [eventId, referenceHash],
    )).rows[0];
    const duplicateIdentity = !!person;
    if (!person) {
      person = (await tx.query<{ id: string; label: string }>(
        "INSERT INTO protected_people (id,event_id,reference_hash,label) VALUES ($1,$2,$3,$4) RETURNING id,label",
        [randomUUID(), eventId, referenceHash, cleanLabel],
      )).rows[0];
    }
    await tx.query(
      "INSERT INTO protected_invitations (id,event_id,person_id,code_hash) VALUES ($1,$2,$3,$4)",
      [randomUUID(), eventId, person.id, codeHash(code)],
    );
    await audit(tx, eventId, ORGANIZER_ID, "INVITATION_ISSUED", duplicateIdentity ? "EXISTING_ATTENDEE" : "NEW_ATTENDEE", { personId: person.id });
    return { ok: true, reasonCode: "INVITATION_ISSUED", personId: person.id, label: person.label, duplicateIdentity, code };
  });
}

export async function protectedAccount(eventId: string, accountId: string) {
  const db = await getDb();
  return (await db.query<{ person_id: string; review_state: string; review_reason: string | null; username: string }>(
    `SELECT c.person_id,p.review_state,p.review_reason,c.username FROM protected_credentials c
     JOIN protected_people p ON p.id=c.person_id WHERE c.event_id=$1 AND c.account_id=$2`,
    [eventId, accountId],
  )).rows[0] ?? null;
}

export async function claimInvitation(eventId: string, code: string, usernameInput: string, password: string, ipAddress: string) {
  const username = normalizeUsername(usernameInput);
  if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 10 || password.length > 128) {
    return { ok: false, reasonCode: "INVALID_CREDENTIALS", message: "Use a 3–32 character username (letters, numbers, underscore) and a 10–128 character password." };
  }
  const hashedPassword = await passwordDigest(password);
  const ipHash = await privateHash(`signup-ip:${eventId}:${ipAddress}`);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = (await tx.query<EventRow>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [eventId])).rows[0];
    if (!event || event.access_mode !== "PROTECTED") return { ok: false, reasonCode: "PROTECTED_EVENT_REQUIRED", message: "Protected event not found." };
    if (event.status !== "ENTRY_OPEN" || new Date(event.entry_closes_at).getTime() <= Date.now()) return { ok: false, reasonCode: "ENTRY_CLOSED", message: "The invitation window has closed." };
    const invitation = (await tx.query<{ id: string; person_id: string; claimed_account_id: string | null }>(
      "SELECT id,person_id,claimed_account_id FROM protected_invitations WHERE event_id=$1 AND code_hash=$2 FOR UPDATE", [eventId, codeHash(code)],
    )).rows[0];
    if (!invitation) {
      await audit(tx, eventId, null, "REQUEST_REJECTED", "INVITATION_INVALID");
      return { ok: false, reasonCode: "INVITATION_INVALID", message: "The invitation was not recognized." };
    }
    if (invitation.claimed_account_id) {
      await audit(tx, eventId, null, "REQUEST_REJECTED", "INVITATION_ALREADY_CLAIMED", { personId: invitation.person_id });
      return { ok: false, reasonCode: "INVITATION_ALREADY_CLAIMED", message: "This invitation has already been claimed. Sign in with your username and password." };
    }
    const person = (await tx.query<{ review_state: string }>(
      "SELECT review_state FROM protected_people WHERE id=$1 AND event_id=$2 FOR UPDATE", [invitation.person_id, eventId],
    )).rows[0];
    const priorPerson = (await tx.query<{ account_id: string }>(
      "SELECT account_id FROM protected_credentials WHERE event_id=$1 AND person_id=$2", [eventId, invitation.person_id],
    )).rows[0];
    if (priorPerson) {
      await audit(tx, eventId, null, "REQUEST_REJECTED", "PERSON_ALREADY_CLAIMED", { personId: invitation.person_id });
      return { ok: false, reasonCode: "PERSON_ALREADY_CLAIMED", message: "This attendee already has an account for the event." };
    }
    if (person.review_state === "BLOCKED") {
      await audit(tx, eventId, null, "REQUEST_REJECTED", "ATTENDEE_BLOCKED", { personId: invitation.person_id });
      return { ok: false, reasonCode: "ATTENDEE_BLOCKED", message: "This attendee cannot claim an invitation. Contact the organizer." };
    }
    const usernameUsed = (await tx.query<{ account_id: string }>(
      "SELECT account_id FROM protected_credentials WHERE event_id=$1 AND username=$2", [eventId, username],
    )).rows[0];
    if (usernameUsed) return { ok: false, reasonCode: "USERNAME_TAKEN", message: "Choose another username." };
    const sameAddress = Number((await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM protected_credentials WHERE event_id=$1 AND signup_ip_hash=$2", [eventId, ipHash],
    )).rows[0].count);
    const reviewRequired = sameAddress >= 3 && person.review_state !== "REVIEW_REQUIRED";
    const accountId = randomUUID();
    await tx.query(
      "INSERT INTO demo_accounts (id,display_name,role,auth_kind) VALUES ($1,$2,'buyer','PASSWORD')",
      [accountId, `Buyer ${username} ${accountId.slice(0, 6)}`],
    );
    await tx.query(
      "INSERT INTO protected_credentials (account_id,event_id,person_id,username,password_hash,signup_ip_hash) VALUES ($1,$2,$3,$4,$5,$6)",
      [accountId, eventId, invitation.person_id, username, hashedPassword, ipHash],
    );
    await tx.query("UPDATE protected_invitations SET claimed_account_id=$1,claimed_at=clock_timestamp() WHERE id=$2", [accountId, invitation.id]);
    if (reviewRequired) await tx.query(
      "UPDATE protected_people SET review_state='REVIEW_REQUIRED',review_reason='SHARED_SIGNUP_ADDRESS' WHERE id=$1", [invitation.person_id],
    );
    await audit(tx, eventId, accountId, "INVITATION_CLAIMED", reviewRequired ? "REVIEW_REQUIRED" : "ELIGIBILITY_CLAIMED", { personId: invitation.person_id });
    return { ok: true, reasonCode: reviewRequired ? "REVIEW_REQUIRED" : "ELIGIBILITY_CLAIMED", accountId, reviewRequired };
  });
}

export async function signInProtected(eventId: string, usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  const db = await getDb();
  const row = (await db.query<{ account_id: string; password_hash: string }>(
    "SELECT account_id,password_hash FROM protected_credentials WHERE event_id=$1 AND username=$2", [eventId, username],
  )).rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) return { ok: false, reasonCode: "LOGIN_FAILED", message: "Username or password was not accepted." };
  await db.query(
    "INSERT INTO audit_events (id,event_id,account_id,type,reason_code) VALUES ($1,$2,$3,'PROTECTED_SIGN_IN','SIGNED_IN')",
    [randomUUID(), eventId, row.account_id],
  );
  return { ok: true, reasonCode: "SIGNED_IN", accountId: row.account_id };
}

export async function protectedOverview(eventId: string) {
  const db = await getDb();
  const people = await db.query<{ id: string; label: string; review_state: string; review_reason: string | null; invitations: string; claims: string; entries: string }>(
    `SELECT p.id,p.label,p.review_state,p.review_reason,
      (SELECT count(*)::text FROM protected_invitations i WHERE i.person_id=p.id) AS invitations,
      (SELECT count(*)::text FROM protected_credentials c WHERE c.person_id=p.id) AS claims,
      (SELECT count(*)::text FROM queue_entries q WHERE q.person_id=p.id) AS entries
     FROM protected_people p WHERE p.event_id=$1 ORDER BY p.created_at,p.id`, [eventId],
  );
  return people.rows.map((row) => ({ id: row.id, label: row.label, reviewState: row.review_state, reviewReason: row.review_reason,
    invitations: Number(row.invitations), claims: Number(row.claims), entries: Number(row.entries) }));
}

export async function reviewProtectedPerson(eventId: string, personId: string, state: "APPROVED" | "BLOCKED") {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = (await tx.query<EventRow>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [eventId])).rows[0];
    if (!event || event.access_mode !== "PROTECTED") return { ok: false, reasonCode: "PROTECTED_EVENT_REQUIRED" };
    const person = (await tx.query<{ id: string; review_state: string }>(
      "SELECT id,review_state FROM protected_people WHERE id=$1 AND event_id=$2 FOR UPDATE", [personId, eventId],
    )).rows[0];
    if (!person) return { ok: false, reasonCode: "ATTENDEE_NOT_FOUND" };
    if (person.review_state === state) return { ok: true, reasonCode: "ALREADY_REVIEWED", reviewState: state };
    if (state === "BLOCKED") {
      const active = (await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM reservations WHERE event_id=$1 AND person_id=$2 AND state IN ('ACTIVE','CONFIRMED')", [eventId, personId],
      )).rows[0];
      if (Number(active.count) > 0) return { ok: false, reasonCode: "REVIEW_LOCKED", message: "An active hold or order must be resolved before blocking." };
      await tx.query("UPDATE queue_entries SET state='EXPIRED' WHERE event_id=$1 AND person_id=$2 AND state IN ('QUEUED','ADMITTED')", [eventId, personId]);
    }
    await tx.query("UPDATE protected_people SET review_state=$1,review_reason=NULL WHERE id=$2", [state, personId]);
    await audit(tx, eventId, ORGANIZER_ID, "ATTENDEE_REVIEWED", state, { personId });
    return { ok: true, reasonCode: "ATTENDEE_REVIEWED", reviewState: state };
  });
}
