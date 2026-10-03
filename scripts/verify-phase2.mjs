import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const eventId = process.env.PHASE2_EVENT_ID;
if (!eventId) throw new Error("Set PHASE2_EVENT_ID to the output of seed-phase2-fixture.mjs");
const envFile = await readFile(".env.local", "utf8");
const adminSecret = envFile.split(/\r?\n/).find((line) => line.startsWith("ADMIN_SECRET="))?.slice("ADMIN_SECRET=".length);
if (!adminSecret) throw new Error("ADMIN_SECRET missing from .env.local");

async function call(path, { method = "GET", cookie, headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

const demo = await call("/api/demo-accounts");
assert.equal(demo.status, 200);
const accounts = demo.data.accounts;
assert.ok(accounts.length >= 6);

const unauthorized = await call(`/api/admin/events/${eventId}/close-entry`, { method: "POST" });
assert.equal(unauthorized.status, 403);
const login = await call("/api/admin/session", { method: "POST", body: { secret: adminSecret } });
assert.equal(login.status, 200);
const adminCookie = login.cookie;
const prematureSale = await call(`/api/admin/events/${eventId}/start-sale`, { method: "POST", cookie: adminCookie });
assert.equal(prematureSale.status, 409);
assert.equal(prematureSale.data.reasonCode, "INVALID_TRANSITION");
const opened = await call(`/api/admin/events/${eventId}/open-entry`, { method: "POST", cookie: adminCookie });
assert.equal(opened.status, 200);
assert.equal(opened.data.state, "ENTRY_OPEN");
const openedAgain = await call(`/api/admin/events/${eventId}/open-entry`, { method: "POST", cookie: adminCookie });
assert.equal(openedAgain.data.reasonCode, "ALREADY_OPEN");

const buyerCookies = [];
const joined = [];
for (const account of accounts) {
  const login = await call("/api/session", { method: "POST", body: { accountId: account.id } });
  assert.equal(login.status, 200);
  buyerCookies.push(login.cookie);
}
for (let i = 0; i < 5; i++) {
  const join = await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyerCookies[i], body: { userId: accounts[5].id, position: 1 } });
  assert.equal(join.status, 200);
  joined.push(join.data.buyer.entry.id);
}
const repeatedJoin = await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyerCookies[0] });
assert.equal(repeatedJoin.data.reasonCode, "ALREADY_JOINED");
assert.equal(repeatedJoin.data.buyer.entry.id, joined[0]);

const close1 = await call(`/api/admin/events/${eventId}/close-entry`, { method: "POST", cookie: adminCookie });
assert.equal(close1.status, 200);
assert.equal(close1.data.orderedCount, 5);
const overview1 = await call(`/api/admin/events/${eventId}`, { cookie: adminCookie });
const positions1 = overview1.data.queue.entries.map((entry) => entry.position);
assert.equal(new Set(positions1).size, 5);
assert.deepEqual([...positions1].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
const close2 = await call(`/api/admin/events/${eventId}/close-entry`, { method: "POST", cookie: adminCookie });
assert.equal(close2.data.reasonCode, "ALREADY_ORDERED");
const overview2 = await call(`/api/admin/events/${eventId}`, { cookie: adminCookie });
assert.deepEqual(overview2.data.queue.entries.map((entry) => entry.position), positions1);

const lateJoin = await call(`/api/events/${eventId}/join`, { method: "POST", cookie: buyerCookies[5] });
assert.equal(lateJoin.status, 409);
assert.equal(lateJoin.data.reasonCode, "ENTRY_CLOSED");

const sale = await call(`/api/admin/events/${eventId}/start-sale`, { method: "POST", cookie: adminCookie });
assert.equal(sale.status, 200);
const key1 = "phase2-admit-first";
const admit1 = await call(`/api/admin/events/${eventId}/admit`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key1 } });
assert.equal(admit1.status, 200);
assert.equal(admit1.data.admitted.length, 2);
assert.deepEqual(admit1.data.admitted.map((entry) => entry.position), [1, 2]);
const retry = await call(`/api/admin/events/${eventId}/admit`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": key1 } });
assert.deepEqual(retry.data, admit1.data);
const full = await call(`/api/admin/events/${eventId}/admit`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": "phase2-admit-full" } });
assert.equal(full.data.reasonCode, "CAPACITY_FULL");
assert.equal(full.data.admitted.length, 0);
const admittedBuyer = await call(`/api/events/${eventId}/me`, { cookie: buyerCookies[accounts.findIndex((account) => account.displayName === overview1.data.queue.entries[0].displayName)] });
assert.equal(admittedBuyer.data.buyer.state, "ADMITTED");
assert.equal(admittedBuyer.data.buyer.entry.position, 1);
assert.ok(admittedBuyer.data.buyer.entry.admissionExpiresAt);

await new Promise((resolve) => setTimeout(resolve, 5500));
const expiredBuyer = await call(`/api/events/${eventId}/me`, { cookie: buyerCookies[accounts.findIndex((account) => account.displayName === overview1.data.queue.entries[0].displayName)] });
assert.equal(expiredBuyer.data.buyer.state, "EXPIRED");
const admit2 = await call(`/api/admin/events/${eventId}/admit`, { method: "POST", cookie: adminCookie, headers: { "Idempotency-Key": "phase2-admit-second" } });
assert.deepEqual(admit2.data.admitted.map((entry) => entry.position), [3, 4]);
assert.equal(admit2.data.expiredAdmissions, 2);
const finalOverview = await call(`/api/admin/events/${eventId}`, { cookie: adminCookie });
assert.equal(finalOverview.data.event.available + finalOverview.data.event.reserved + finalOverview.data.event.sold, 5);
console.log(JSON.stringify({ eventId, opened: opened.data.state, invalidTransition: prematureSale.data.reasonCode, orderedCount: close1.data.orderedCount, stablePositions: true, lateJoin: lateJoin.data.reasonCode, firstBatch: admit1.data.admitted.map((row) => row.position), retrySameBatch: true, capacity: full.data.reasonCode, secondBatch: admit2.data.admitted.map((row) => row.position), expiredAdmissions: admit2.data.expiredAdmissions, inventoryBalanced: true }));
