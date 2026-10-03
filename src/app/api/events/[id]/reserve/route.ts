import { NextResponse } from "next/server";
import { reserveTicket } from "@/lib/checkout";
import { buyerAccountId } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const accountId = await buyerAccountId();
  if (!accountId) return NextResponse.json({ reasonCode: "NOT_SIGNED_IN", message: "Choose a demo account first." }, { status: 401 });
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 128) return NextResponse.json({ reasonCode: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key of 8 to 128 characters." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 }); }
  if (!body || Array.isArray(body) || typeof body !== "object") return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 });
  const result = await reserveTicket((await context.params).id, accountId, key, body);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "EVENT_NOT_FOUND" ? 404 : 409 });
}
