import { NextResponse } from "next/server";
import { consumeClaimLimit, auditDecision } from "@/lib/abuse";
import { validateClaimChallenge } from "@/lib/challenge";
import { getEvent } from "@/lib/event";
import { claimInvitation } from "@/lib/protected-sale";
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
  const data = body && typeof body === "object" ? body as { code?: unknown; username?: unknown; password?: unknown; challengeToken?: unknown } : {};
  if (typeof data.code !== "string" || typeof data.username !== "string" || typeof data.password !== "string") return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 });
  const challenge = await validateClaimChallenge(data.challengeToken, request);
  if (!challenge.ok) {
    await auditDecision(id, null, "REQUEST_REJECTED", challenge.reasonCode);
    return NextResponse.json(challenge, { status: challenge.reasonCode === "CHALLENGE_UNAVAILABLE" || challenge.reasonCode === "CHALLENGE_NOT_CONFIGURED" ? 503 : 409 });
  }
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const result = await claimInvitation(id, data.code, data.username, data.password, address);
  if (result.ok && "accountId" in result && typeof result.accountId === "string") await setBuyerSession(result.accountId);
  const safeResult = result.ok ? { ok: true, reasonCode: result.reasonCode, reviewRequired: "reviewRequired" in result ? result.reviewRequired : false } : result;
  return NextResponse.json(safeResult, { status: result.ok ? 200 : result.reasonCode === "INVALID_CREDENTIALS" ? 400 : 409, headers: { "Cache-Control": "no-store" } });
}
