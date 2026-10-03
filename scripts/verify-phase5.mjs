import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = process.env.LAB_BASE_URL ?? "http://localhost:3001";
const configText = await readFile(".env.local", "utf8");
const secret = configText.split(/\r?\n/).find((line) => line.startsWith("ADMIN_SECRET="))?.slice("ADMIN_SECRET=".length);
if (!secret) throw new Error("ADMIN_SECRET missing");
async function call(path, { method = "GET", cookie, body, redirect } = {}) {
  const response = await fetch(`${base}${path}`, { method, redirect, headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: response.headers.get("content-type")?.includes("json") ? await response.json() : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0], location: response.headers.get("location") };
}
const admin = (await call("/api/admin/session", { method: "POST", body: { secret } })).cookie;
assert.ok(admin);
const sourceId = (await call("/admin", { cookie: admin, redirect: "manual" })).location.split("/").at(-1);
const unauthorized = await call(`/api/admin/events/${sourceId}/lab`);
assert.equal(unauthorized.status, 403);
const config = { seed: "phase5-check", population: 9, inventory: 3, maxConcurrency: 4 };
const first = await call(`/api/admin/events/${sourceId}/lab/run`, { method: "POST", cookie: admin, body: config });
const second = await call(`/api/admin/events/${sourceId}/lab/run`, { method: "POST", cookie: admin, body: config });
assert.equal(first.status, 200, first.data?.message);
assert.equal(second.status, 200, second.data?.message);
assert.notEqual(first.data.runId, second.data.runId);
assert.notEqual(first.data.eventId, second.data.eventId);
for (const run of [first.data, second.data]) {
  assert.equal(run.results.fairDrop.acceptedEntries, 9);
  assert.equal(run.results.fairDrop.allocations, 3);
  assert.equal(run.results.fairDrop.oversells, 0);
  assert.equal(run.results.fairDrop.duplicateOrders, 0);
  assert.equal(run.results.fairDrop.queueIntegrityViolations, 0);
  assert.deepEqual(run.results.fairDrop.reconnectFailures, []);
  assert.ok(run.results.fairDrop.throttledRequests > 0);
  assert.equal(run.results.baseline.winners, 3);
  assert.equal(run.results.cohorts.reduce((sum, row) => sum + row.eligible, 0), 9);
  assert.equal(run.results.cohorts.reduce((sum, row) => sum + row.allocations, 0), 3);
}
assert.deepEqual(first.data.results.cohorts, second.data.results.cohorts);
const history = await call(`/api/admin/events/${sourceId}/lab`, { cookie: admin });
assert.equal(history.status, 200);
assert.ok(history.data.runs.some((row) => row.id === first.data.runId && row.eventId === first.data.eventId));
assert.ok(history.data.runs.some((row) => row.id === second.data.runId && row.eventId === second.data.eventId));
const sourceMetrics = await call(`/api/admin/events/${sourceId}/metrics`, { cookie: admin });
assert.equal(sourceMetrics.data.orders, 0);
const buyers = (await call("/api/demo-accounts")).data.accounts;
const buyer = (await call("/api/session", { method: "POST", body: { accountId: buyers[0].id } })).cookie;
const joined = await call(`/api/events/${sourceId}/join`, { method: "POST", cookie: buyer });
assert.equal(joined.status, 200);
const receipt = (await call(`/api/events/${sourceId}/me`, { cookie: buyer })).data.buyer.receipt;
assert.ok(receipt.acceptedAt);
assert.ok(receipt.policyVersion);
assert.equal(receipt.finalPosition, null);
assert.equal(receipt.purchaseOutcome, "NOT_PURCHASED");
console.log(JSON.stringify({ separateRuns: true, stableCohorts: true, throttling: first.data.results.fairDrop.throttledRequests,
  zeroOversells: true, zeroDuplicateOrders: true, sourceOrders: sourceMetrics.data.orders, buyerReceipt: true }));
