import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getDb } from "./db";
import { buyerCookieHeader, organizerCookieHeader } from "./session";
import { getEvent } from "./event";

export type LabConfig = { seed: string; population: number; inventory: number; maxConcurrency: number };
type Profile = "ordinary" | "same_account_retry" | "flood";
type Client = { id: string; accountId: string; index: number; profile: Profile; arrivalMs: number; cookie: string };
type RequestLog = { clientId: string; profile: Profile; operation: string; status: number; reasonCode: string | null; latencyMs: number };
type ApiResult = { status: number; data: Record<string, unknown> };

function seededNumber(seed: string, index: number) {
  let hash = 2166136261;
  for (const character of `${seed}:${index}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return Math.round(ordered[Math.ceil(fraction * ordered.length) - 1] * 10) / 10;
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(callback: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try { return await callback(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}

export function validateLabConfig(value: unknown): LabConfig | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.seed !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(data.seed)) return null;
  if (!Number.isInteger(data.population) || Number(data.population) < 6 || Number(data.population) > 24) return null;
  if (!Number.isInteger(data.inventory) || Number(data.inventory) < 1 || Number(data.inventory) > Number(data.population)) return null;
  if (!Number.isInteger(data.maxConcurrency) || Number(data.maxConcurrency) < 1 || Number(data.maxConcurrency) > 8) return null;
  return { seed: data.seed, population: Number(data.population), inventory: Number(data.inventory), maxConcurrency: Number(data.maxConcurrency) };
}

export async function runFairnessLab(sourceEventId: string, config: LabConfig, baseUrl: string) {
  const source = await getEvent(sourceEventId);
  if (!source) return { ok: false, reasonCode: "EVENT_NOT_FOUND" };
  const db = await getDb();
  const runId = randomUUID();
  const eventId = randomUUID();
  const profiles: Profile[] = ["ordinary", "same_account_retry", "flood"];
  const logicalClients = Array.from({ length: config.population }, (_, index) => {
    const profile = profiles[index % profiles.length];
    const arrivalMs = Math.floor(seededNumber(config.seed, index) * 180) + (profile === "ordinary" ? 130 : profile === "same_account_retry" ? 65 : 0);
    return { id: `buyer-${String(index + 1).padStart(2, "0")}`, accountId: randomUUID(), index, profile, arrivalMs };
  });
  const schedule = logicalClients.flatMap((client) => {
    const joins = client.profile === "ordinary" ? 1 : client.profile === "same_account_retry" ? 5 : 16;
    return Array.from({ length: joins }, (_, attempt) => ({ clientId: client.id, profile: client.profile,
      operation: "join", atMs: client.arrivalMs + attempt * 8 }));
  });
  const storedConfig = { ...config, cohorts: profiles, schedule, simulation: true, baselineModel: "first unique request wins" };
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO simulation_runs (id,source_event_id,seed,config,status) VALUES ($1,$2,$3,$4::jsonb,'RUNNING')",
      [runId, sourceEventId, config.seed, JSON.stringify(storedConfig)],
    );
    await tx.query(
      `INSERT INTO events (id,name,status,entry_opens_at,entry_closes_at,total_inventory,available,reserved,sold,batch_size,reservation_ttl_seconds,admission_ttl_seconds,queue_policy_version,simulation_run_id)
       VALUES ($1,$2,'ENTRY_OPEN',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$3,$3,0,0,1,300,120,'lab-seeded-hash-v1',$4)`,
      [eventId, `Fairness Lab ${runId.slice(0, 8)}`, config.inventory, runId],
    );
    await tx.query("UPDATE simulation_runs SET event_id=$1 WHERE id=$2", [eventId, runId]);
    for (const client of logicalClients) await tx.query(
      "INSERT INTO demo_accounts (id,display_name,role,auth_kind,simulation_index) VALUES ($1,$2,'buyer','SIMULATION',$3)",
      [client.accountId, `Sim ${runId.slice(0, 8)} ${client.id}`, client.index],
    );
  });

  const requestLog: RequestLog[] = [];
  const semaphore = new Semaphore(config.maxConcurrency);
  const adminCookie = await organizerCookieHeader();
  const clients: Client[] = await Promise.all(logicalClients.map(async (client) => ({ ...client, cookie: await buyerCookieHeader(client.accountId) })));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const clientByAccount = new Map(clients.map((client) => [client.accountId, client]));
  async function api(path: string, method: "GET" | "POST", cookie: string, operation: string, client?: Client, key?: string): Promise<ApiResult> {
    return semaphore.run(async () => {
      const started = performance.now();
      const response = await fetch(`${baseUrl}${path}`, { method, headers: {
        Cookie: cookie, ...(key ? { "Idempotency-Key": key } : {}), ...(operation === "reserve" ? { "Content-Type": "application/json" } : {}),
        ...(client ? { "X-Forwarded-For": `198.51.100.${client.index + 1}` } : {}),
      }, body: operation === "reserve" ? "{}" : undefined, cache: "no-store" });
      const data = await response.json() as Record<string, unknown>;
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      if (client) requestLog.push({ clientId: client.id, profile: client.profile, operation, status: response.status,
        reasonCode: typeof data.reasonCode === "string" ? data.reasonCode : null, latencyMs });
      return { status: response.status, data };
    });
  }
  const admin = (operation: string, key?: string) => api(`/api/admin/events/${eventId}/${operation}`, "POST", adminCookie, operation, undefined, key);
  try {
    const started = performance.now();
    await Promise.all(schedule.map(async (job) => {
      await sleep(job.atMs - (performance.now() - started));
      const client = clientById.get(job.clientId)!;
      await api(`/api/events/${eventId}/join`, "POST", client.cookie, "join", client);
    }));
    const firstEntries = (await db.query<{ account_id: string; id: string }>("SELECT account_id,id FROM queue_entries WHERE event_id=$1", [eventId])).rows;
    const close = await admin("close-entry");
    if (close.status !== 200) throw new Error(`close-entry: ${String(close.data.reasonCode)}`);
    const positionsBefore = (await db.query<{ account_id: string; position: number }>(
      "SELECT account_id,position FROM queue_entries WHERE event_id=$1 ORDER BY account_id", [eventId],
    )).rows;
    const ordinary = clients.find((client) => client.profile === "ordinary")!;
    await api(`/api/events/${eventId}/join`, "POST", ordinary.cookie, "join_after_close", ordinary);
    const positionsAfter = (await db.query<{ account_id: string; position: number }>(
      "SELECT account_id,position FROM queue_entries WHERE event_id=$1 ORDER BY account_id", [eventId],
    )).rows;
    const sale = await admin("start-sale");
    if (sale.status !== 200) throw new Error(`start-sale: ${String(sale.data.reasonCode)}`);
    const reconnectFailures: string[] = [];
    for (let step = 0; step < config.population; step++) {
      const admitted = await admin("admit", `${runId}-admit-${step}`);
      if (admitted.status !== 200) throw new Error(`admit: ${String(admitted.data.reasonCode)}`);
      const batch = admitted.data.admitted as { id: string; position: number }[];
      if (!batch.length) break;
      const entry = (await db.query<{ account_id: string }>("SELECT account_id FROM queue_entries WHERE id=$1", [batch[0].id])).rows[0];
      const client = clientByAccount.get(entry.account_id)!;
      const reserveKey = `${runId}-reserve-${client.id}`;
      const reserveCalls = client.profile === "ordinary" ? 1 : 2;
      const reserves = await Promise.all(Array.from({ length: reserveCalls }, () =>
        api(`/api/events/${eventId}/reserve`, "POST", client.cookie, "reserve", client, reserveKey)));
      const successful = reserves.find((result) => result.status === 200 && typeof (result.data.reservation as { id?: string } | undefined)?.id === "string");
      if (!successful) continue;
      const reservationId = (successful.data.reservation as { id: string }).id;
      const confirmCalls = client.profile === "ordinary" ? 1 : 2;
      const confirms = await Promise.all(Array.from({ length: confirmCalls }, () =>
        api(`/api/reservations/${reservationId}/confirm`, "POST", client.cookie, "confirm", client)));
      const confirmed = confirms.find((result) => result.status === 200 && typeof (result.data.order as { id?: string } | undefined)?.id === "string");
      if (confirmed) {
        const me = await api(`/api/events/${eventId}/me`, "GET", client.cookie, "reconnect_status", client);
        const buyer = me.data.buyer as { order?: { id?: string } } | undefined;
        if (buyer?.order?.id !== (confirmed.data.order as { id: string }).id) reconnectFailures.push(client.id);
      }
      const stock = (await db.query<{ sold: number }>("SELECT sold FROM events WHERE id=$1", [eventId])).rows[0];
      if (stock.sold >= config.inventory) break;
    }
    const [orders, entries, inventory] = await Promise.all([
      db.query<{ account_id: string; count: string }>("SELECT account_id,count(*)::text AS count FROM orders WHERE event_id=$1 GROUP BY account_id", [eventId]),
      db.query<{ account_id: string; count: string }>("SELECT account_id,count(*)::text AS count FROM queue_entries WHERE event_id=$1 GROUP BY account_id", [eventId]),
      db.query<{ available: number; reserved: number; sold: number; total_inventory: number }>(
        "SELECT available,reserved,sold,total_inventory FROM events WHERE id=$1", [eventId]),
    ]);
    const orderAccounts = new Set(orders.rows.map((row) => row.account_id));
    const baselineWinners = new Set([...clients].sort((a, b) => a.arrivalMs - b.arrivalMs || a.index - b.index).slice(0, config.inventory).map((client) => client.accountId));
    const cohortRows = profiles.map((profile) => {
      const members = clients.filter((client) => client.profile === profile);
      const requests = requestLog.filter((row) => row.profile === profile);
      const allocations = members.filter((client) => orderAccounts.has(client.accountId)).length;
      const baselineAllocations = members.filter((client) => baselineWinners.has(client.accountId)).length;
      return { profile, eligible: members.length, requests: requests.length, allocations,
        allocationRate: allocations / members.length, requestToAllocation: allocations ? requests.length / allocations : null,
        baselineAllocations, baselineAllocationRate: baselineAllocations / members.length,
        throttledRequests: requests.filter((row) => row.status === 429).length };
    });
    const stock = inventory.rows[0];
    const positionChanged = JSON.stringify(positionsBefore) !== JSON.stringify(positionsAfter);
    const duplicateEntries = entries.rows.reduce((sum, row) => sum + Math.max(0, Number(row.count) - 1), 0);
    const duplicateOrders = orders.rows.reduce((sum, row) => sum + Math.max(0, Number(row.count) - 1), 0);
    const positionSet = new Set(positionsAfter.map((row) => row.position));
    const queueIntegrityViolations = duplicateEntries + (positionChanged ? 1 : 0) + (positionSet.size !== positionsAfter.length ? 1 : 0);
    const baseline = { label: "First-request-wins model (not a competitor system)", winners: baselineWinners.size,
      policy: "Earliest scheduled first request from each logical account wins until inventory is exhausted." };
    const results = { runId, eventId, seed: config.seed, config: storedConfig, baseline, cohorts: cohortRows,
      fairDrop: { allocations: orderAccounts.size, acceptedEntries: firstEntries.length, requestCount: requestLog.length,
        throttledRequests: requestLog.filter((row) => row.status === 429).length,
        oversells: Math.max(0, stock.sold - stock.total_inventory), duplicateOrders, queueIntegrityViolations,
        reconnectFailures, inventory: stock },
      latencyMs: { method: "Server-side HTTP request start to parsed JSON response for buyer API calls", p50: percentile(requestLog.map((row) => row.latencyMs), 0.5),
        p95: percentile(requestLog.map((row) => row.latencyMs), 0.95) },
      clients: clients.map(({ id, index, profile, arrivalMs }) => ({ id, index, profile, arrivalMs })), requestLog,
      limitations: ["Logical clients are Node HTTP requests, not concurrent browser connections.",
        "One account per person is not proven in this account-only run.", "Account farms, network diversity, payment abuse, and production-scale load are untested."],
    };
    await db.transaction(async (tx) => {
      await tx.query("UPDATE simulation_runs SET completed_at=clock_timestamp(),status='COMPLETED',results=$2::jsonb WHERE id=$1", [runId, JSON.stringify(results)]);
      await tx.query("UPDATE audit_events SET simulation_run_id=$1 WHERE event_id=$2 AND simulation_run_id IS NULL", [runId, eventId]);
    });
    return { ok: true, runId, eventId, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown simulation error";
    await db.query("UPDATE simulation_runs SET completed_at=clock_timestamp(),status='FAILED',results=$2::jsonb WHERE id=$1", [runId, JSON.stringify({ error: message })]);
    return { ok: false, reasonCode: "SIMULATION_FAILED", runId, eventId, message };
  }
}

export async function labHistory(sourceEventId: string) {
  const db = await getDb();
  const rows = await db.query<{ id: string; event_id: string | null; seed: string; config: unknown; status: string; started_at: string; completed_at: string | null; results: unknown }>(
    "SELECT id,event_id,seed,config,status,started_at,completed_at,results FROM simulation_runs WHERE source_event_id=$1 ORDER BY started_at DESC,id DESC LIMIT 12", [sourceEventId],
  );
  return rows.rows.map((row) => {
    const result = typeof row.results === "string" ? JSON.parse(row.results) : row.results;
    const { requestLog: _requestLog, clients: _clients, ...summary } = result && typeof result === "object" ? result as Record<string, unknown> : {};
    void _requestLog; void _clients;
    return { id: row.id, eventId: row.event_id, seed: row.seed,
      config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
      status: row.status, startedAt: new Date(row.started_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      results: summary };
  });
}
