import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = process.env.BASE_URL ?? "http://localhost:3001";
const envFile = await readFile(".env.local", "utf8");
const secret = envFile.split(/\r?\n/).find((line) => line.startsWith("ADMIN_SECRET="))?.slice(13);
if (!secret) throw new Error("ADMIN_SECRET missing");
async function call(path, { method = "GET", cookie, key, body, redirect } = {}) {
  const response = await fetch(`${base}${path}`, { method, redirect,
    headers: { ...(cookie ? { cookie } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: response.headers.get("content-type")?.includes("json") ? await response.json() : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0], location: response.headers.get("location") };
}
const accounts = (await call("/api/demo-accounts")).data.accounts;
const buyer = (await call("/api/session", { method: "POST", body: { accountId: accounts[0].id } })).cookie;
const admin = (await call("/api/admin/session", { method: "POST", body: { secret } })).cookie;
const current = await call("/admin", { cookie: admin, redirect: "manual" });
assert.equal(current.status, 307);
const eventId = current.location.split("/").at(-1);
assert.equal((await call(`/api/admin/events/${eventId}/metrics`)).status, 403);
assert.equal((await call(`/api/admin/events/${eventId}/metrics`, { cookie: buyer })).status, 403);
assert.equal((await call(`/api/admin/events/${eventId}/close-entry`, { method: "POST", cookie: buyer })).status, 403);
assert.equal((await call(`/api/admin/events/${eventId}`, { cookie: buyer })).status, 403);
const joined = await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyer });
assert.equal(joined.status, 200);
const entryId = joined.data.buyer.entry.id;
const joinStatuses = [];
for (let i = 0; i < 14; i++) joinStatuses.push((await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyer })).status);
assert.ok(joinStatuses.includes(429));
const throttledJoin = await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyer });
assert.equal(throttledJoin.status, 429);
assert.equal(throttledJoin.data.reasonCode, "RATE_LIMITED");
const statusResults = [];
for (let i = 0; i < 200; i++) statusResults.push((await call(`/api/events/${eventId}/me`, { cookie: buyer })).status);
assert.ok(statusResults.includes(429));
const closed = await call(`/api/admin/events/${eventId}/close-entry`, { method: "POST", cookie: admin });
assert.equal(closed.status, 200);
const metrics = await call(`/api/admin/events/${eventId}/metrics`, { cookie: admin });
assert.equal(metrics.status, 200);
assert.equal(metrics.data.queue.depth, 1);
assert.equal(metrics.data.inventory.balanced, true);
assert.equal(metrics.data.throttledRequests, joinStatuses.filter((status) => status === 429).length + 1 + statusResults.filter((status) => status === 429).length);
assert.ok(metrics.data.recentDecisions.some((decision) => decision.reasonCode === "RATE_LIMITED"));
const overview = await call(`/api/admin/events/${eventId}`, { cookie: admin });
assert.equal(overview.data.queue.entries.length, 1);
assert.equal(overview.data.queue.entries[0].position, 1);
const reset = await call(`/api/admin/events/${eventId}/reset-demo`, { method: "POST", cookie: admin, key: "phase4-reset-key" });
assert.equal(reset.status, 200);
assert.notEqual(reset.data.eventId, eventId);
const retry = await call(`/api/admin/events/${eventId}/reset-demo`, { method: "POST", cookie: admin, key: "phase4-reset-key" });
assert.deepEqual(retry.data, reset.data);
const stale = await call(`/api/admin/events/${eventId}/reset-demo`, { method: "POST", cookie: admin, key: "phase4-another-reset" });
assert.equal(stale.status, 409);
assert.equal(stale.data.reasonCode, "STALE_DEMO_EVENT");
const nextCurrent = await call("/admin", { cookie: admin, redirect: "manual" });
assert.ok(nextCurrent.location.endsWith(reset.data.eventId));
const newMetrics = await call(`/api/admin/events/${reset.data.eventId}/metrics`, { cookie: admin });
assert.equal(newMetrics.data.queue.depth, 0);
assert.deepEqual(newMetrics.data.inventory, { total: 500, available: 500, reserved: 0, sold: 0, balanced: true });
const oldOverview = await call(`/api/admin/events/${eventId}`, { cookie: admin });
assert.equal(oldOverview.data.queue.entries.length, 1);
assert.equal(oldOverview.data.queue.entries[0].position, 1);
assert.equal(entryId, joined.data.buyer.entry.id);
console.log(JSON.stringify({ eventId, nextEventId: reset.data.eventId, join429: joinStatuses.filter((x) => x === 429).length + 1,
  status429: statusResults.filter((x) => x === 429).length, queuePreserved: true, resetIdempotent: true, inventoryBalanced: true }));
