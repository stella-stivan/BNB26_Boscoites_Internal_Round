import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const fixtures = JSON.parse(process.env.PHASE3_FIXTURES ?? "null");
if (!fixtures?.lastTicket || !fixtures?.expiry || !fixtures?.confirmExpiry) throw new Error("Set PHASE3_FIXTURES to fixture JSON");
const envFile = await readFile(".env.local", "utf8");
const secret = envFile.split(/\r?\n/).find((line) => line.startsWith("ADMIN_SECRET="))?.slice(13);
if (!secret) throw new Error("ADMIN_SECRET missing");
async function call(path, { method = "GET", cookie, key, body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const accounts = (await call("/api/demo-accounts")).data.accounts;
const cookies = [];
for (const account of accounts.slice(0, 3)) cookies.push((await call("/api/session", { method: "POST", body: { accountId: account.id } })).cookie);
const admin = (await call("/api/admin/session", { method: "POST", body: { secret } })).cookie;
const balance = async (id, expected) => {
  const result = await call(`/api/admin/events/${id}`, { cookie: admin });
  assert.equal(result.status, 200);
  const { available, reserved, sold, total_inventory } = result.data.event;
  assert.deepEqual([available, reserved, sold], expected);
  assert.equal(available + reserved + sold, total_inventory);
};

const target = fixtures.lastTicket;
const unauth = await call(`/api/events/${target}/reserve`, { method: "POST", key: "third-party-1", body: {} });
assert.equal(unauth.status, 401);
const [one, two] = await Promise.all([0, 1].map((i) => call(`/api/events/${target}/reserve`, { method: "POST", cookie: cookies[i], key: `last-ticket-${i}`, body: {} })));
assert.deepEqual([one.status, two.status].sort(), [200, 409]);
const winner = one.status === 200 ? 0 : 1;
const reservation = (winner === 0 ? one : two).data.reservation;
assert.ok(reservation.id);
await balance(target, [0, 1, 0]);
const retry = await call(`/api/events/${target}/reserve`, { method: "POST", cookie: cookies[winner], key: `last-ticket-${winner}`, body: {} });
assert.deepEqual(retry.data, (winner === 0 ? one : two).data);
const conflict = await call(`/api/events/${target}/reserve`, { method: "POST", cookie: cookies[winner], key: `last-ticket-${winner}`, body: { changed: true } });
assert.equal(conflict.status, 409);
assert.equal(conflict.data.reasonCode, "IDEMPOTENCY_CONFLICT");
const reconnect = await call(`/api/events/${target}/me`, { cookie: cookies[winner] });
assert.equal(reconnect.data.buyer.state, "RESERVED");
assert.equal(reconnect.data.buyer.reservation.id, reservation.id);
const other = await call(`/api/reservations/${reservation.id}/confirm`, { method: "POST", cookie: cookies[2] });
assert.equal(other.status, 404);
const [confirm1, confirm2] = await Promise.all([1, 2].map(() => call(`/api/reservations/${reservation.id}/confirm`, { method: "POST", cookie: cookies[winner] })));
assert.equal(confirm1.status, 200);
assert.equal(confirm2.status, 200);
assert.equal(confirm1.data.order.id, confirm2.data.order.id);
await balance(target, [0, 0, 1]);
const confirmedReconnect = await call(`/api/events/${target}/me`, { cookie: cookies[winner] });
assert.equal(confirmedReconnect.data.buyer.order.id, confirm1.data.order.id);

const exp = fixtures.expiry;
const expHold = await call(`/api/events/${exp}/reserve`, { method: "POST", cookie: cookies[0], key: "expiry-hold-1", body: {} });
assert.equal(expHold.status, 200);
await new Promise((resolve) => setTimeout(resolve, 2300));
const [expired, expiredConfirm] = await Promise.all([
  call(`/api/admin/events/${exp}/expire-holds`, { method: "POST", cookie: admin }),
  call(`/api/reservations/${expHold.data.reservation.id}/confirm`, { method: "POST", cookie: cookies[0] }),
]);
assert.equal(expiredConfirm.data.reasonCode, "HOLD_EXPIRED");
assert.equal(expired.status, 200);
await balance(exp, [1, 0, 0]);
assert.equal((await call(`/api/events/${exp}/me`, { cookie: cookies[0] })).data.buyer.state, "EXPIRED");

const race = fixtures.confirmExpiry;
const raceHold = await call(`/api/events/${race}/reserve`, { method: "POST", cookie: cookies[0], key: "confirm-expiry-1", body: {} });
assert.equal(raceHold.status, 200);
const [raceConfirm, raceExpiry] = await Promise.all([
  call(`/api/reservations/${raceHold.data.reservation.id}/confirm`, { method: "POST", cookie: cookies[0] }),
  call(`/api/admin/events/${race}/expire-holds`, { method: "POST", cookie: admin }),
]);
assert.equal(raceConfirm.status, 200);
assert.equal(raceExpiry.status, 200);
await balance(race, [0, 0, 1]);
console.log(JSON.stringify({ lastTicket: "one winner", duplicateConfirm: confirm1.data.order.id === confirm2.data.order.id, expiry: "released", confirmExpiry: "one order", reconnect: "same hold and order", inventoryBalanced: true }));
