import { readFile } from "node:fs/promises";

const base = process.env.LAB_BASE_URL ?? "http://localhost:3000";
const seed = process.env.LAB_SEED ?? "fairdrop-demo-1";
const population = Number(process.env.LAB_POPULATION ?? 12);
const inventory = Number(process.env.LAB_INVENTORY ?? 5);
const maxConcurrency = Number(process.env.LAB_CONCURRENCY ?? 6);
const configText = await readFile(".env.local", "utf8");
const secret = configText.split(/\r?\n/).find((line) => line.startsWith("ADMIN_SECRET="))?.slice("ADMIN_SECRET=".length);
if (!secret) throw new Error("ADMIN_SECRET missing from .env.local");
const login = await fetch(`${base}/api/admin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
if (!login.ok) throw new Error(`Organizer login failed (${login.status})`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Organizer cookie missing");
const current = await fetch(`${base}/admin`, { headers: { Cookie: cookie }, redirect: "manual" });
const sourceEventId = process.env.LAB_SOURCE_EVENT_ID ?? current.headers.get("location")?.split("/").at(-1);
if (!sourceEventId) throw new Error("Set LAB_SOURCE_EVENT_ID or ensure /admin redirects to the current event");
const response = await fetch(`${base}/api/admin/events/${sourceEventId}/lab/run`, {
  method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ seed, population, inventory, maxConcurrency }),
});
const result = await response.json();
if (!response.ok) throw new Error(`${result.reasonCode ?? response.status}: ${result.message ?? "Lab run failed"}`);
console.log(JSON.stringify({ runId: result.runId, eventId: result.eventId, seed,
  fairDrop: result.results.fairDrop, baseline: result.results.baseline, cohorts: result.results.cohorts,
  latencyMs: result.results.latencyMs }, null, 2));
