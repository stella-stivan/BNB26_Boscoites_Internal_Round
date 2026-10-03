import { createHash, randomUUID } from "node:crypto";
import { getDb, type Queryable } from "./db";
import type { EventRow } from "./event";

type ReservationRow = { id: string; event_id: string; account_id: string; person_id: string | null; queue_entry_id: string; state: string; expires_at: string };
type OrderRow = { id: string; reservation_id: string; confirmed_at: string };
type Result = { ok: boolean; reasonCode: string; message?: string; reservation?: { id: string; expiresAt: string }; order?: { id: string; confirmedAt: string } };

const iso = (value: string) => new Date(value).toISOString();
const hold = (row: ReservationRow) => ({ id: row.id, expiresAt: iso(row.expires_at) });

async function lockEvent(tx: Queryable, eventId: string) {
  return (await tx.query<EventRow>("SELECT * FROM events WHERE id=$1 FOR UPDATE", [eventId])).rows[0] ?? null;
}

// Event-first locking is shared by reserve, confirm, and expiry. The reservation row
// is then locked as well, so confirm and expiry can never each transfer its stock.
export async function expireDueHolds(eventId: string, tx: Queryable): Promise<number> {
  const due = await tx.query<ReservationRow>(
    "SELECT * FROM reservations WHERE event_id=$1 AND state='ACTIVE' AND expires_at <= clock_timestamp() ORDER BY created_at, id FOR UPDATE",
    [eventId],
  );
  for (const row of due.rows) {
    await tx.query("UPDATE reservations SET state='EXPIRED' WHERE id=$1 AND state='ACTIVE'", [row.id]);
    await tx.query("UPDATE events SET reserved=reserved-1, available=available+1 WHERE id=$1", [eventId]);
    await tx.query("UPDATE queue_entries SET state='EXPIRED' WHERE id=$1 AND state='RESERVED'", [row.queue_entry_id]);
    await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,reason_code,metadata) VALUES ($1,$2,$3,'RESERVATION_EXPIRED','HOLD_EXPIRED',$4::jsonb)",
      [randomUUID(), eventId, row.account_id, JSON.stringify({ reservationId: row.id })],
    );
  }
  return due.rows.length;
}

export async function expireDueAdmissions(eventId: string, tx: Queryable): Promise<number> {
  const expired = await tx.query<{ account_id: string }>(
    `UPDATE queue_entries SET state='EXPIRED' WHERE event_id=$1 AND state='ADMITTED'
     AND admission_expires_at <= clock_timestamp() RETURNING account_id`, [eventId],
  );
  for (const row of expired.rows) await tx.query(
    "INSERT INTO audit_events (id,event_id,account_id,type,reason_code) VALUES ($1,$2,$3,'ADMISSION_EXPIRED','ADMISSION_EXPIRED')",
    [randomUUID(), eventId, row.account_id],
  );
  return expired.rows.length;
}

export async function expireEventHolds(eventId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const event = await lockEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", expired: 0 };
    const expired = await expireDueHolds(eventId, tx);
    const expiredAdmissions = await expireDueAdmissions(eventId, tx);
    return { ok: true, reasonCode: "EXPIRY_COMPLETE", expired, expiredAdmissions };
  });
}

export async function reserveTicket(eventId: string, accountId: string, key: string, requestBody: unknown): Promise<Result> {
  const db = await getDb();
  const requestHash = createHash("sha256").update(JSON.stringify(requestBody)).digest("hex");
  return db.transaction(async (tx) => {
    const event = await lockEvent(tx, eventId);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND", message: "Event not found." };
    const operation = "RESERVE";
    const prior = (await tx.query<{ request_hash: string; response_body: Result }>(
      "SELECT request_hash,response_body FROM idempotency_records WHERE event_id=$1 AND account_id=$2 AND operation=$3 AND key=$4",
      [eventId, accountId, operation, key],
    )).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) {
        await tx.query(
          "INSERT INTO audit_events (id,event_id,account_id,type,reason_code) VALUES ($1,$2,$3,'REQUEST_REJECTED','IDEMPOTENCY_CONFLICT')",
          [randomUUID(), eventId, accountId],
        );
        return { ok: false, reasonCode: "IDEMPOTENCY_CONFLICT", message: "This key was used with a different request." };
      }
      return typeof prior.response_body === "string" ? JSON.parse(prior.response_body) : prior.response_body;
    }
    await expireDueHolds(eventId, tx);
    await expireDueAdmissions(eventId, tx);
    const stock = (await tx.query<{ available: number }>("SELECT available FROM events WHERE id=$1", [eventId])).rows[0];
    let result: Result;
    const entry = (await tx.query<{ id: string; state: string; person_id: string | null; admission_expires_at: string | null }>(
      "SELECT id,state,person_id,admission_expires_at FROM queue_entries WHERE event_id=$1 AND account_id=$2 FOR UPDATE",
      [eventId, accountId],
    )).rows[0];
    const access = event.access_mode === "PROTECTED" ? (await tx.query<{ person_id: string; review_state: string }>(
      `SELECT c.person_id,p.review_state FROM protected_credentials c JOIN protected_people p ON p.id=c.person_id
       WHERE c.event_id=$1 AND c.account_id=$2`, [eventId, accountId],
    )).rows[0] : null;
    const admissionCurrent = entry ? (await tx.query<{ current: boolean }>(
      "SELECT $1::timestamptz > clock_timestamp() AS current", [entry.admission_expires_at],
    )).rows[0].current : false;
    const order = (await tx.query<OrderRow>("SELECT id,reservation_id,confirmed_at FROM orders WHERE event_id=$1 AND account_id=$2", [eventId, accountId])).rows[0];
    const existing = (await tx.query<ReservationRow>(
      "SELECT * FROM reservations WHERE event_id=$1 AND account_id=$2 AND state IN ('ACTIVE','CONFIRMED') FOR UPDATE",
      [eventId, accountId],
    )).rows[0];
    if (order) result = { ok: true, reasonCode: "ALREADY_CONFIRMED", order: { id: order.id, confirmedAt: iso(order.confirmed_at) } };
    else if (existing) result = { ok: true, reasonCode: "ALREADY_RESERVED", reservation: hold(existing) };
    else if (event.status !== "SELLING") result = { ok: false, reasonCode: "SALE_NOT_ACTIVE", message: "The sale is not active." };
    else if (event.access_mode === "PROTECTED" && (!access || access.person_id !== entry?.person_id))
      result = { ok: false, reasonCode: "ELIGIBILITY_REQUIRED", message: "This reservation requires your verified attendee entry." };
    else if (event.access_mode === "PROTECTED" && access?.review_state !== "APPROVED")
      result = { ok: false, reasonCode: access?.review_state === "BLOCKED" ? "ATTENDEE_BLOCKED" : "REVIEW_REQUIRED", message: "Organizer review is required before checkout." };
    else if (!entry || entry.state !== "ADMITTED" || !admissionCurrent)
      result = { ok: false, reasonCode: "ADMISSION_REQUIRED", message: "A current admission for your signed-in account is required." };
    else if (stock.available <= 0) result = { ok: false, reasonCode: "SOLD_OUT", message: "No tickets are available right now." };
    else {
      const id = randomUUID();
      const reserved = (await tx.query<ReservationRow>(
        `INSERT INTO reservations (id,event_id,account_id,person_id,queue_entry_id,state,expires_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',clock_timestamp() + $6::integer * interval '1 second') RETURNING *`,
        [id, eventId, accountId, entry.person_id, entry.id, event.reservation_ttl_seconds],
      )).rows[0];
      await tx.query("UPDATE events SET available=available-1,reserved=reserved+1 WHERE id=$1", [eventId]);
      await tx.query("UPDATE queue_entries SET state='RESERVED' WHERE id=$1", [entry.id]);
      await tx.query(
        "INSERT INTO audit_events (id,event_id,account_id,type,metadata) VALUES ($1,$2,$3,'TICKET_RESERVED',$4::jsonb)",
        [randomUUID(), eventId, accountId, JSON.stringify({ reservationId: id })],
      );
      result = { ok: true, reasonCode: "RESERVED", reservation: hold(reserved) };
    }
    await tx.query(
      "INSERT INTO idempotency_records (event_id,account_id,operation,key,request_hash,response_status,response_body) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [eventId, accountId, operation, key, requestHash, result.ok ? 200 : 409, JSON.stringify(result)],
    );
    if (["SOLD_OUT", "ELIGIBILITY_REQUIRED", "REVIEW_REQUIRED", "ATTENDEE_BLOCKED"].includes(result.reasonCode)) await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,reason_code) VALUES ($1,$2,$3,'REQUEST_REJECTED',$4)",
      [randomUUID(), eventId, accountId, result.reasonCode],
    );
    return result;
  });
}

export async function confirmReservation(reservationId: string, accountId: string): Promise<Result> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Read the event id without locking, then acquire locks in the shared order.
    const ref = (await tx.query<{ event_id: string }>("SELECT event_id FROM reservations WHERE id=$1", [reservationId])).rows[0];
    if (!ref) return { ok: false, reasonCode: "RESERVATION_NOT_FOUND", message: "Reservation not found." };
    const event = await lockEvent(tx, ref.event_id);
    if (!event) return { ok: false, reasonCode: "EVENT_NOT_FOUND" };
    const row = (await tx.query<ReservationRow>("SELECT * FROM reservations WHERE id=$1 FOR UPDATE", [reservationId])).rows[0];
    if (!row || row.account_id !== accountId) return { ok: false, reasonCode: "RESERVATION_NOT_FOUND", message: "Reservation not found." };
    const prior = (await tx.query<OrderRow>("SELECT id,reservation_id,confirmed_at FROM orders WHERE reservation_id=$1", [reservationId])).rows[0];
    if (prior) return { ok: true, reasonCode: "ALREADY_CONFIRMED", order: { id: prior.id, confirmedAt: iso(prior.confirmed_at) } };
    if (row.state !== "ACTIVE") return { ok: false, reasonCode: "HOLD_EXPIRED", message: "The reservation has expired." };
    const holdCurrent = (await tx.query<{ current: boolean }>(
      "SELECT $1::timestamptz > clock_timestamp() AS current", [row.expires_at],
    )).rows[0].current;
    if (!holdCurrent) {
      await expireDueHolds(ref.event_id, tx);
      return { ok: false, reasonCode: "HOLD_EXPIRED", message: "The reservation has expired." };
    }
    const order = (await tx.query<OrderRow>(
      "INSERT INTO orders (id,event_id,account_id,person_id,reservation_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,reservation_id,confirmed_at",
      [randomUUID(), ref.event_id, accountId, row.person_id, reservationId],
    )).rows[0];
    await tx.query("UPDATE reservations SET state='CONFIRMED' WHERE id=$1", [reservationId]);
    await tx.query("UPDATE queue_entries SET state='CONFIRMED' WHERE id=$1", [row.queue_entry_id]);
    await tx.query("UPDATE events SET reserved=reserved-1,sold=sold+1 WHERE id=$1", [ref.event_id]);
    await tx.query(
      "INSERT INTO audit_events (id,event_id,account_id,type,metadata) VALUES ($1,$2,$3,'PURCHASE_CONFIRMED',$4::jsonb)",
      [randomUUID(), ref.event_id, accountId, JSON.stringify({ reservationId, orderId: order.id })],
    );
    return { ok: true, reasonCode: "CONFIRMED", order: { id: order.id, confirmedAt: iso(order.confirmed_at) } };
  });
}
