import { createHash, randomUUID } from "node:crypto";
import { getDb, type Queryable } from "./db";
import type { EventRow } from "./event";
import { expireDueAdmissions, expireDueHolds } from "./checkout";

const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";
type PositionRow = { id: string; position: number };

async function lockedEvent(tx: Queryable, eventId: string) {
  return (await tx.query<EventRow>("SELECT * FROM events WHERE id = $1 FOR UPDATE", [eventId])).rows[0] ?? null;
}

export async function openEntry(eventId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = await lockedEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    if (event.status === "ENTRY_OPEN") return { ok: true, state: "ENTRY_OPEN", reasonCode: "ALREADY_OPEN" };
    if (event.status !== "DRAFT") return { ok: false, reasonCode: "INVALID_TRANSITION", message: "Only a draft event can open entry." };
    const now = Date.now();
    if (now < new Date(event.entry_opens_at).getTime() || now >= new Date(event.entry_closes_at).getTime()) {
      return { ok: false, reasonCode: "ENTRY_WINDOW_NOT_ACTIVE", message: "The published entry window is not active." };
    }
    await tx.query("UPDATE events SET status = 'ENTRY_OPEN' WHERE id = $1", [eventId]);
    await tx.query("INSERT INTO audit_events (id,event_id,account_id,type) VALUES ($1,$2,$3,'ENTRY_OPENED')", [randomUUID(), eventId, ORGANIZER_ID]);
    return { ok: true, state: "ENTRY_OPEN", reasonCode: "ENTRY_OPENED" };
  });
}

export async function closeAndOrder(eventId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = await lockedEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    if (event.ordered_at) return {
      ok: true, state: event.status, reasonCode: "ALREADY_ORDERED", orderedCount: event.ordered_count ?? 0,
      orderingCutoffAt: new Date(event.ordering_cutoff_at ?? event.entry_closes_at).toISOString(),
      policyVersion: event.queue_policy_version,
    };
    if (event.status !== "ENTRY_OPEN") return { ok: false, reasonCode: "INVALID_TRANSITION", message: "Entry must be open before it can be closed." };
    if (event.access_mode === "PROTECTED") {
      const pending = Number((await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM queue_entries q JOIN protected_people p ON p.id=q.person_id
         WHERE q.event_id=$1 AND q.state='QUEUED' AND p.review_state <> 'APPROVED'`, [eventId],
      )).rows[0].count);
      if (pending) return { ok: false, reasonCode: "PENDING_REVIEW", message: "Review or block flagged attendees before closing entry." };
    }
    const cutoff = new Date(Math.min(Date.now(), new Date(event.entry_closes_at).getTime())).toISOString();
    const simulationSeed = event.simulation_run_id ? (await tx.query<{ seed: string }>(
      "SELECT seed FROM simulation_runs WHERE id=$1", [event.simulation_run_id],
    )).rows[0]?.seed : null;
    const ranked = await tx.query<PositionRow>(
      `WITH ranked AS (
         SELECT q.id, row_number() OVER (ORDER BY ${simulationSeed ? "md5($3::text || ':' || a.simulation_index::text)" : "random()"}, q.id)::integer AS position
       FROM queue_entries q ${simulationSeed ? "JOIN demo_accounts a ON a.id=q.account_id" : ""}
       WHERE q.event_id = $1 AND q.state = 'QUEUED' AND q.received_at < $2
       )
       UPDATE queue_entries AS q SET position = ranked.position
       FROM ranked WHERE q.id = ranked.id
       RETURNING q.id, q.position`,
      simulationSeed ? [eventId, cutoff, simulationSeed] : [eventId, cutoff],
    );
    await tx.query(
      `UPDATE events SET status = 'ENTRY_CLOSED', entry_closes_at = $2,
       ordering_cutoff_at = $2, ordered_at = now(), ordered_count = $3 WHERE id = $1`,
      [eventId, cutoff, ranked.rows.length],
    );
    await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,metadata) VALUES ($1,$2,$3,'QUEUE_ORDERED',$4::jsonb)",
      [randomUUID(), eventId, ORGANIZER_ID, JSON.stringify({ eligibleCount: ranked.rows.length, cutoff, policyVersion: event.queue_policy_version })],
    );
    return { ok: true, state: "ENTRY_CLOSED", reasonCode: "ORDERED", orderedCount: ranked.rows.length, orderingCutoffAt: cutoff, policyVersion: event.queue_policy_version };
  });
}

export async function startSale(eventId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = await lockedEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    if (event.status === "SELLING") return { ok: true, state: "SELLING", reasonCode: "ALREADY_SELLING" };
    if (event.status !== "ENTRY_CLOSED" || !event.ordered_at) return { ok: false, reasonCode: "INVALID_TRANSITION", message: "Close and order entry before starting the sale." };
    await tx.query("UPDATE events SET status = 'SELLING' WHERE id = $1", [eventId]);
    await tx.query("INSERT INTO audit_events (id,event_id,account_id,type) VALUES ($1,$2,$3,'SALE_STARTED')", [randomUUID(), eventId, ORGANIZER_ID]);
    return { ok: true, state: "SELLING", reasonCode: "SALE_STARTED" };
  });
}

export async function admitNext(eventId: string, idempotencyKey: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = await lockedEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    const operation = "ADMIT_BATCH";
    const existing = (await tx.query<{ response_body: unknown }>(
      "SELECT response_body FROM idempotency_records WHERE event_id=$1 AND account_id=$2 AND operation=$3 AND key=$4",
      [eventId, ORGANIZER_ID, operation, idempotencyKey],
    )).rows[0];
    if (existing) return typeof existing.response_body === "string" ? JSON.parse(existing.response_body) : existing.response_body;
    if (event.status !== "SELLING") return { ok: false, reasonCode: "INVALID_TRANSITION", message: "Start the sale before admitting buyers." };

    await expireDueHolds(eventId, tx);

    const expiredAdmissions = await expireDueAdmissions(eventId, tx);
    const active = Number((await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM queue_entries WHERE event_id=$1 AND state='ADMITTED' AND admission_expires_at > now()", [eventId],
    )).rows[0].count);
    const slots = Math.max(0, event.batch_size - active);
    const next = slots ? (await tx.query<PositionRow>(
      `SELECT id, position FROM queue_entries WHERE event_id=$1 AND state='QUEUED' AND position IS NOT NULL
       ORDER BY position LIMIT $2 FOR UPDATE`, [eventId, slots],
    )).rows : [];
    const admitted: { id: string; position: number; admissionExpiresAt: string }[] = [];
    for (const row of next) {
      const updated = (await tx.query<{ admission_expires_at: string }>(
        `UPDATE queue_entries SET state='ADMITTED', admitted_at=now(),
         admission_expires_at=now() + $2::integer * interval '1 second'
         WHERE id=$1 RETURNING admission_expires_at`, [row.id, event.admission_ttl_seconds],
      )).rows[0];
      admitted.push({ id: row.id, position: row.position, admissionExpiresAt: new Date(updated.admission_expires_at).toISOString() });
    }
    const remainingQueued = Number((await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM queue_entries WHERE event_id=$1 AND state='QUEUED' AND position IS NOT NULL", [eventId],
    )).rows[0].count);
    const result = {
      ok: true, state: "SELLING", reasonCode: slots === 0 ? "CAPACITY_FULL" : admitted.length ? "BATCH_ADMITTED" : "QUEUE_EMPTY",
      admitted, activeAdmissions: active + admitted.length, remainingQueued, admissionTtlSeconds: event.admission_ttl_seconds,
      expiredAdmissions,
    };
    await tx.query(
      "INSERT INTO idempotency_records (event_id,account_id,operation,key,request_hash,response_status,response_body) VALUES ($1,$2,$3,$4,$5,200,$6::jsonb)",
      [eventId, ORGANIZER_ID, operation, idempotencyKey, createHash("sha256").update(`${eventId}:${operation}`).digest("hex"), JSON.stringify(result)],
    );
    await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,reason_code,metadata) VALUES ($1,$2,$3,'BATCH_ADMISSION',$4,$5::jsonb)",
      [randomUUID(), eventId, ORGANIZER_ID, result.reasonCode, JSON.stringify({ admittedEntryIds: admitted.map((row) => row.id), activeAdmissions: result.activeAdmissions, remainingQueued })],
    );
    return result;
  });
}

export async function queueOverview(eventId: string) {
  const db = await getDb();
  const counts = await db.query<{ state: string; count: string }>(
    `SELECT effective_state AS state, count(*)::text AS count FROM (
       SELECT CASE WHEN state='ADMITTED' AND admission_expires_at <= now() THEN 'EXPIRED' ELSE state END AS effective_state
       FROM queue_entries WHERE event_id=$1
     ) q GROUP BY effective_state`, [eventId],
  );
  const ordered = await db.query<{ display_name: string; position: number; state: string; admission_expires_at: string | null }>(
    `SELECT a.display_name, q.position,
       CASE WHEN q.state='ADMITTED' AND q.admission_expires_at <= now() THEN 'EXPIRED' ELSE q.state END AS state,
       q.admission_expires_at
     FROM queue_entries q JOIN demo_accounts a ON a.id=q.account_id
     WHERE q.event_id=$1 ORDER BY q.position NULLS LAST, q.received_at`, [eventId],
  );
  return {
    counts: Object.fromEntries(counts.rows.map((row) => [row.state, Number(row.count)])),
    entries: ordered.rows.map((row) => ({ displayName: row.display_name, position: row.position, state: row.state,
      admissionExpiresAt: row.admission_expires_at ? new Date(row.admission_expires_at).toISOString() : null })),
  };
}
