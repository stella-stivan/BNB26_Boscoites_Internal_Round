import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";
import { getEvent } from "./event";
import { expireEventHolds } from "./checkout";

const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";

export async function eventMetrics(eventId: string) {
  await expireEventHolds(eventId);
  const event = await getEvent(eventId);
  if (!event) return null;
  const db = await getDb();
  const [queue, holds, orders, audits, recent] = await Promise.all([
    db.query<{ state: string; count: string }>(
      `SELECT CASE WHEN state='ADMITTED' AND admission_expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE state END AS state,
        count(*)::text AS count FROM queue_entries WHERE event_id=$1 GROUP BY 1`, [eventId],
    ),
    db.query<{ state: string; count: string }>("SELECT state,count(*)::text AS count FROM reservations WHERE event_id=$1 GROUP BY state", [eventId]),
    db.query<{ count: string }>("SELECT count(*)::text AS count FROM orders WHERE event_id=$1", [eventId]),
    db.query<{ throttled: string; errors: string; duplicate_people: string; challenge_failures: string; invalid_invitations: string }>(
      `SELECT count(*) FILTER (WHERE type='REQUEST_THROTTLED')::text AS throttled,
        count(*) FILTER (WHERE type='REQUEST_REJECTED')::text AS errors,
        count(*) FILTER (WHERE reason_code IN ('PERSON_ALREADY_CLAIMED','PERSON_ALREADY_ENTERED'))::text AS duplicate_people,
        count(*) FILTER (WHERE reason_code IN ('CHALLENGE_FAILED','CHALLENGE_REQUIRED','CHALLENGE_UNAVAILABLE'))::text AS challenge_failures,
        count(*) FILTER (WHERE reason_code IN ('INVITATION_INVALID','INVITATION_ALREADY_CLAIMED'))::text AS invalid_invitations
       FROM audit_events WHERE event_id=$1`, [eventId],
    ),
    db.query<{ id: string; type: string; reason_code: string | null; occurred_at: string }>(
      "SELECT id,type,reason_code,occurred_at FROM audit_events WHERE event_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20", [eventId],
    ),
  ]);
  const queueCounts = Object.fromEntries(queue.rows.map((row) => [row.state, Number(row.count)]));
  const reservationCounts = Object.fromEntries(holds.rows.map((row) => [row.state, Number(row.count)]));
  const orderCount = Number(orders.rows[0].count);
  return {
    eventId,
    inventory: { total: event.total_inventory, available: event.available, reserved: event.reserved, sold: event.sold,
      balanced: event.available + event.reserved + event.sold === event.total_inventory },
    queue: { depth: queueCounts.QUEUED ?? 0, admitted: queueCounts.ADMITTED ?? 0, reserved: queueCounts.RESERVED ?? 0,
      confirmed: queueCounts.CONFIRMED ?? 0, expired: queueCounts.EXPIRED ?? 0 },
    reservations: { active: reservationCounts.ACTIVE ?? 0, confirmed: reservationCounts.CONFIRMED ?? 0, expired: reservationCounts.EXPIRED ?? 0 },
    orders: orderCount,
    throttledRequests: Number(audits.rows[0].throttled),
    errorRequests: Number(audits.rows[0].errors),
    abuse: { duplicatePeople: Number(audits.rows[0].duplicate_people), challengeFailures: Number(audits.rows[0].challenge_failures),
      invalidInvitations: Number(audits.rows[0].invalid_invitations) },
    recentDecisions: recent.rows.map((row) => ({ id: row.id, type: row.type, reasonCode: row.reason_code,
      occurredAt: new Date(row.occurred_at).toISOString() })),
    serverTime: new Date().toISOString(),
  };
}

export async function resetDemoEvent(eventId: string, key: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const previous = (await tx.query<{
      id: string; total_inventory: number; batch_size: number; reservation_ttl_seconds: number;
      admission_ttl_seconds: number; queue_policy_version: string;
    }>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [eventId])).rows[0];
    if (!previous) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    const operation = "RESET_DEMO";
    const prior = (await tx.query<{ response_body: unknown }>(
      "SELECT response_body FROM idempotency_records WHERE event_id=$1 AND account_id=$2 AND operation=$3 AND key=$4",
      [eventId, ORGANIZER_ID, operation, key],
    )).rows[0];
    if (prior) return typeof prior.response_body === "string" ? JSON.parse(prior.response_body) : prior.response_body;
    const current = (await tx.query<{ event_id: string }>("SELECT event_id FROM demo_current_event WHERE singleton=true FOR UPDATE")).rows[0];
    if (current?.event_id !== eventId) return { ok: false, reasonCode: "STALE_DEMO_EVENT", message: "This is no longer the current demo event." };
    const newId = randomUUID();
    await tx.query(
      `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold,batch_size,reservation_ttl_seconds,admission_ttl_seconds,queue_policy_version)
       VALUES ($1,$2,'ENTRY_OPEN',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '24 hours',$3,$3,0,0,$4,$5,$6,$7)`,
      [newId, `Fair Drop demo sale ${new Date().toISOString().slice(0, 16)}`, previous.total_inventory, previous.batch_size,
        previous.reservation_ttl_seconds, previous.admission_ttl_seconds, previous.queue_policy_version],
    );
    await tx.query("UPDATE demo_current_event SET event_id=$1 WHERE singleton=true", [newId]);
    const result = { ok: true, reasonCode: "DEMO_RESET", eventId: newId, previousEventId: eventId };
    await tx.query(
      "INSERT INTO idempotency_records (event_id,account_id,operation,key,request_hash,response_status,response_body) VALUES ($1,$2,$3,$4,$5,200,$6::jsonb)",
      [eventId, ORGANIZER_ID, operation, key, createHash("sha256").update(`${eventId}:${operation}`).digest("hex"), JSON.stringify(result)],
    );
    await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,reason_code,metadata) VALUES ($1,$2,$3,'DEMO_RUN_CREATED','FRESH_EVENT',$4::jsonb)",
      [randomUUID(), newId, ORGANIZER_ID, JSON.stringify({ previousEventId: eventId })],
    );
    return result;
  });
}
