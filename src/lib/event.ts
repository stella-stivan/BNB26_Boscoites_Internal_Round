import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { expireEventHolds } from "./checkout";
import { protectedAccount } from "./protected-sale";

export type EventRow = {
  id: string;
  name: string;
  status: "DRAFT" | "ENTRY_OPEN" | "ENTRY_CLOSED" | "SELLING" | "SOLD_OUT" | "CLOSED";
  entry_opens_at: string;
  entry_closes_at: string;
  total_inventory: number;
  available: number;
  reserved: number;
  sold: number;
  batch_size: number;
  reservation_ttl_seconds: number;
  admission_ttl_seconds: number;
  queue_policy_version: string;
  access_mode: "DEMO" | "PROTECTED";
  simulation_run_id: string | null;
  ordering_cutoff_at: string | null;
  ordered_at: string | null;
  ordered_count: number | null;
};

export type QueueEntry = {
  id: string;
  event_id: string;
  account_id: string;
  received_at: string;
  position: number | null;
  state: string;
  admitted_at: string | null;
  admission_expires_at: string | null;
};

export type BuyerState = {
  state: string;
  account: { id: string; displayName: string } | null;
  entry: { id: string; receivedAt: string; position: number | null; admittedAt: string | null; admissionExpiresAt: string | null } | null;
  peopleAhead: number | null;
  reservation: { id: string; expiresAt: string } | null;
  order: { id: string; confirmedAt: string } | null;
  receipt: { acceptedAt: string; policyVersion: string; cutoffAt: string | null; finalPosition: number | null;
    admittedAt: string | null; admissionOutcome: string; purchaseOutcome: string; reasonCodes: string[] } | null;
  reasonCode: string | null;
  message: string;
};

export async function getEvent(id: string): Promise<EventRow | null> {
  const db = await getDb();
  const { rows } = await db.query<EventRow>("SELECT * FROM events WHERE id = $1", [id]);
  const row = rows[0];
  return row ? {
    ...row,
    entry_opens_at: new Date(row.entry_opens_at).toISOString(),
    entry_closes_at: new Date(row.entry_closes_at).toISOString(),
    ordering_cutoff_at: row.ordering_cutoff_at ? new Date(row.ordering_cutoff_at).toISOString() : null,
    ordered_at: row.ordered_at ? new Date(row.ordered_at).toISOString() : null,
  } : null;
}

export async function getDemoAccounts() {
  const db = await getDb();
  const { rows } = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM demo_accounts WHERE role = 'buyer' AND auth_kind='DEMO' ORDER BY display_name",
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

export async function getBuyerState(eventId: string, accountId: string | null): Promise<BuyerState> {
  const event = await getEvent(eventId);
  const signInMessage = event?.access_mode === "PROTECTED" ? "Claim an invitation or sign in to join." : "Choose a demo account to join.";
  if (!accountId) return { state: "NOT_SIGNED_IN", account: null, entry: null, peopleAhead: null, reservation: null, order: null, receipt: null, reasonCode: null, message: signInMessage };
  const access = event?.access_mode === "PROTECTED" ? await protectedAccount(eventId, accountId) : null;
  if (event?.access_mode === "PROTECTED" && !access) return { state: "NOT_SIGNED_IN", account: null, entry: null, peopleAhead: null, reservation: null, order: null, receipt: null, reasonCode: null, message: signInMessage };
  await expireEventHolds(eventId);
  const db = await getDb();
  const accounts = await db.query<{ id: string; display_name: string; auth_kind: string }>(
    "SELECT id, display_name, auth_kind FROM demo_accounts WHERE id = $1 AND role = 'buyer'", [accountId],
  );
  const account = accounts.rows[0];
  if (!account || (event?.access_mode === "DEMO" && account.auth_kind !== (event.simulation_run_id ? "SIMULATION" : "DEMO"))) return { state: "NOT_SIGNED_IN", account: null, entry: null, peopleAhead: null, reservation: null, order: null, receipt: null, reasonCode: null, message: signInMessage };
  const { rows } = await db.query<QueueEntry>(
    "SELECT * FROM queue_entries WHERE event_id = $1 AND account_id = $2", [eventId, accountId],
  );
  const entry = rows[0];
  const reservation = (await db.query<{ id: string; expires_at: string }>(
    "SELECT id,expires_at FROM reservations WHERE event_id=$1 AND account_id=$2 AND state='ACTIVE' ORDER BY created_at DESC LIMIT 1", [eventId, accountId],
  )).rows[0];
  const order = (await db.query<{ id: string; confirmed_at: string }>(
    "SELECT id,confirmed_at FROM orders WHERE event_id=$1 AND account_id=$2", [eventId, accountId],
  )).rows[0];
  const expiredHold = entry?.state === "EXPIRED" ? (await db.query<{ id: string }>(
    "SELECT id FROM reservations WHERE event_id=$1 AND account_id=$2 AND state='EXPIRED' LIMIT 1", [eventId, accountId],
  )).rows[0] : null;
  const reasons = entry ? (await db.query<{ reason_code: string }>(
    "SELECT reason_code FROM audit_events WHERE event_id=$1 AND account_id=$2 AND reason_code IS NOT NULL ORDER BY occurred_at DESC,id DESC LIMIT 12",
    [eventId, accountId],
  )).rows.map((row) => row.reason_code) : [];
  const admissionExpired = entry?.state === "ADMITTED" && entry.admission_expires_at && new Date(entry.admission_expires_at).getTime() <= Date.now();
  const state = access?.review_state === "BLOCKED" ? "BLOCKED" : access?.review_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED"
    : order ? "CONFIRMED" : reservation ? "RESERVED" : admissionExpired ? "EXPIRED" : entry?.state ?? "NOT_JOINED";
  const ahead = entry?.position && state === "QUEUED" ? await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM queue_entries WHERE event_id = $1 AND position < $2 AND state = 'QUEUED'",
    [eventId, entry.position],
  ) : null;
  return {
    state,
    account: { id: account.id, displayName: account.display_name },
    entry: entry ? {
      id: entry.id, receivedAt: new Date(entry.received_at).toISOString(), position: entry.position,
      admittedAt: entry.admitted_at ? new Date(entry.admitted_at).toISOString() : null,
      admissionExpiresAt: entry.admission_expires_at ? new Date(entry.admission_expires_at).toISOString() : null,
    } : null,
    peopleAhead: ahead ? Number(ahead.rows[0]?.count ?? 0) : null,
    reservation: reservation ? { id: reservation.id, expiresAt: new Date(reservation.expires_at).toISOString() } : null,
    order: order ? { id: order.id, confirmedAt: new Date(order.confirmed_at).toISOString() } : null,
    receipt: entry && event ? {
      acceptedAt: new Date(entry.received_at).toISOString(), policyVersion: event.queue_policy_version,
      cutoffAt: event.ordering_cutoff_at ? new Date(event.ordering_cutoff_at).toISOString() : null,
      finalPosition: entry.position, admittedAt: entry.admitted_at ? new Date(entry.admitted_at).toISOString() : null,
      admissionOutcome: entry.admitted_at ? (entry.state === "EXPIRED" && !expiredHold ? "EXPIRED" : "ADMITTED") : "WAITING",
      purchaseOutcome: order ? "CONFIRMED" : reservation ? "HELD" : expiredHold ? "HOLD_EXPIRED" : "NOT_PURCHASED",
      reasonCodes: [...new Set(reasons)],
    } : null,
    reasonCode: access?.review_state === "BLOCKED" ? "ATTENDEE_BLOCKED" : access?.review_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : admissionExpired ? "ADMISSION_EXPIRED" : null,
    message: access?.review_state === "BLOCKED" ? "Your attendee eligibility is blocked. Contact the organizer."
      : access?.review_state === "REVIEW_REQUIRED" ? "Your eligibility needs organizer review before joining or checkout."
      : order ? "Your demo purchase is confirmed."
      : reservation ? "One ticket is held for you. Confirm before the hold expires."
      : entry?.state === "EXPIRED" ? "Your reservation or admission expired."
      : admissionExpired ? "Your admission window expired before a ticket was reserved."
      : state === "ADMITTED" ? "You are admitted. Your admission window is open."
      : entry ? (entry.position ? "Your queue position is assigned." : "Entry accepted. Positions are assigned when entry closes.")
      : "Join during the entry window.",
  };
}

export async function joinQueue(eventId: string, accountId: string) {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const event = (await tx.query<EventRow>("SELECT * FROM events WHERE id = $1 FOR UPDATE", [eventId])).rows[0];
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    let personId: string | null = null;
    if (event.access_mode === "PROTECTED") {
      const access = (await tx.query<{ person_id: string; review_state: string }>(
        `SELECT c.person_id,p.review_state FROM protected_credentials c JOIN protected_people p ON p.id=c.person_id
         WHERE c.event_id=$1 AND c.account_id=$2 FOR UPDATE`, [eventId, accountId],
      )).rows[0];
      if (!access) return { ok: false, reasonCode: "ELIGIBILITY_REQUIRED", message: "Claim an invitation and sign in before joining." };
      if (access.review_state !== "APPROVED") return { ok: false, reasonCode: access.review_state === "BLOCKED" ? "ATTENDEE_BLOCKED" : "REVIEW_REQUIRED", message: "Organizer review is required before joining." };
      personId = access.person_id;
      const otherEntry = (await tx.query<{ account_id: string }>(
        "SELECT account_id FROM queue_entries WHERE event_id=$1 AND person_id=$2", [eventId, personId],
      )).rows[0];
      if (otherEntry && otherEntry.account_id !== accountId) return { ok: false, reasonCode: "PERSON_ALREADY_ENTERED", message: "This attendee already has a queue entry." };
    } else {
      const demoAccount = (await tx.query<{ id: string }>(
        "SELECT id FROM demo_accounts WHERE id=$1 AND auth_kind=$2 AND role='buyer'", [accountId, event.simulation_run_id ? "SIMULATION" : "DEMO"],
      )).rows[0];
      if (!demoAccount) return { ok: false, reasonCode: "DEMO_ACCOUNT_REQUIRED", message: "Choose a demo buyer for this sale." };
    }
    const existing = await tx.query<QueueEntry>(
      "SELECT * FROM queue_entries WHERE event_id = $1 AND account_id = $2", [eventId, accountId],
    );
    if (existing.rows[0]) {
      await tx.query(
        "INSERT INTO audit_events (id, event_id, account_id, type, reason_code) VALUES ($1, $2, $3, 'QUEUE_RESUME', 'ALREADY_JOINED')",
        [randomUUID(), eventId, accountId],
      );
      return { ok: true, reasonCode: "ALREADY_JOINED" };
    }
    const now = Date.now();
    if (event.status !== "ENTRY_OPEN" || now < new Date(event.entry_opens_at).getTime() || now >= new Date(event.entry_closes_at).getTime()) {
      return { ok: false, reasonCode: "ENTRY_CLOSED", message: "The entry window is not open." };
    }
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO queue_entries (id, event_id, account_id, person_id, state)
       VALUES ($1, $2, $3, $4, 'QUEUED')
       ON CONFLICT (event_id, account_id) DO NOTHING RETURNING id`,
      [randomUUID(), eventId, accountId, personId],
    );
    await tx.query(
      "INSERT INTO audit_events (id, event_id, account_id, type, reason_code) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), eventId, accountId, inserted.rows[0] ? "QUEUE_JOIN" : "QUEUE_RESUME", inserted.rows[0] ? null : "ALREADY_JOINED"],
    );
    return { ok: true, reasonCode: inserted.rows[0] ? "JOINED" : "ALREADY_JOINED" };
  });
  return result.ok ? { ...result, buyer: await getBuyerState(eventId, accountId) } : result;
}
