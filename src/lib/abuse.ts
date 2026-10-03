import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";

type Kind = "join" | "status";
const WINDOW_SECONDS = 60;
const limits: Record<Kind, { account: number; ip: number }> = {
  join: { account: 12, ip: 120 },
  status: { account: 90, ip: 600 },
};

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function consume(key: string, limit: number, windowStart: string) {
  const db = await getDb();
  const row = (await db.query<{ hits: number }>(
    `INSERT INTO rate_limit_buckets (bucket_key,window_start,hits) VALUES ($1,$2,1)
     ON CONFLICT (bucket_key) DO UPDATE SET
       hits=CASE WHEN rate_limit_buckets.window_start=$2 THEN rate_limit_buckets.hits+1 ELSE 1 END,
       window_start=$2 RETURNING hits`,
    [key, windowStart],
  )).rows[0];
  return row.hits <= limit;
}

export async function consumeBuyerLimit(eventId: string, accountId: string, kind: Kind, request: Request) {
  const now = Date.now();
  const boundary = Math.floor(now / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000;
  const windowStart = new Date(boundary).toISOString();
  const retryAfter = Math.max(1, Math.ceil((boundary + WINDOW_SECONDS * 1000 - now) / 1000));
  const accountAllowed = await consume(`account:${eventId}:${kind}:${accountId}`, limits[kind].account, windowStart);
  // The proxy address is secondary to the signed account limit. Only a hash is stored.
  const proxyAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const ipAllowed = accountAllowed ? await consume(`ip:${eventId}:${kind}:${digest(proxyAddress)}`, limits[kind].ip, windowStart) : true;
  if (accountAllowed && ipAllowed) return null;
  await auditDecision(eventId, accountId, "REQUEST_THROTTLED", "RATE_LIMITED", { operation: kind, signal: !accountAllowed ? "account" : "ip" });
  return { reasonCode: "RATE_LIMITED", message: `Too many ${kind} requests. Retry after ${retryAfter} seconds.`, retryAfter };
}

export async function consumeClaimLimit(eventId: string, request: Request) {
  const now = Date.now();
  const boundary = Math.floor(now / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000;
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const allowed = await consume(`claim:${eventId}:${digest(address)}`, 20, new Date(boundary).toISOString());
  if (allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((boundary + WINDOW_SECONDS * 1000 - now) / 1000));
  await auditDecision(eventId, null, "REQUEST_THROTTLED", "RATE_LIMITED", { operation: "claim" });
  return { reasonCode: "RATE_LIMITED", message: `Too many attempts. Retry after ${retryAfter} seconds.`, retryAfter };
}

export async function auditDecision(eventId: string, accountId: string | null, type: string, reasonCode: string, metadata: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.query(
    "INSERT INTO audit_events (id,event_id,account_id,type,reason_code,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [randomUUID(), eventId, accountId, type, reasonCode, JSON.stringify(metadata)],
  );
}
