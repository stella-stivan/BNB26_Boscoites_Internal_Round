import { NextResponse } from "next/server";
import { getBuyerState, getEvent } from "@/lib/event";
import { buyerAccountId } from "@/lib/session";
import { consumeBuyerLimit } from "@/lib/abuse";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ reasonCode: "EVENT_NOT_FOUND", message: "Event not found." }, { status: 404 });
  const accountId = await buyerAccountId();
  if (accountId) {
    const limited = await consumeBuyerLimit(id, accountId, "status", request);
    if (limited) return NextResponse.json(limited, { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "no-store" } });
  }
  const buyer = await getBuyerState(id, accountId);
  return NextResponse.json({ event, buyer, serverTime: new Date().toISOString() });
}
