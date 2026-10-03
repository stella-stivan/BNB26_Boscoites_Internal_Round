import { NextResponse } from "next/server";
import { consumeClaimLimit, auditDecision } from "@/lib/abuse";
import { getEvent } from "@/lib/event";
import { signInProtected } from "@/lib/protected-sale";
import { setBuyerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event || event.access_mode !== "PROTECTED") return NextResponse.json({ reasonCode: "PROTECTED_EVENT_REQUIRED" }, { status: 404 });
  const limited = await consumeClaimLimit(id, request);
  if (limited) return NextResponse.json(limited, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 }); }
  const data = body && typeof body === "object" ? body as { username?: unknown; password?: unknown } : {};
  if (typeof data.username !== "string" || typeof data.password !== "string") return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 });
  const result = await signInProtected(id, data.username, data.password);
  if (!result.ok) await auditDecision(id, null, "REQUEST_REJECTED", result.reasonCode);
  if (result.ok && "accountId" in result && typeof result.accountId === "string") await setBuyerSession(result.accountId);
  return NextResponse.json({ ok: result.ok, reasonCode: result.reasonCode, message: "message" in result ? result.message : undefined }, { status: result.ok ? 200 : 401 });
}
