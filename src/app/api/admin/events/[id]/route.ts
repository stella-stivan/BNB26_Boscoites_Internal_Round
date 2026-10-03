import { NextResponse } from "next/server";
import { getEvent } from "@/lib/event";
import { queueOverview } from "@/lib/queue-operations";
import { organizerSession } from "@/lib/session";
import { expireEventHolds } from "@/lib/checkout";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const { id } = await context.params;
  await expireEventHolds(id);
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ reasonCode: "EVENT_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ event, queue: await queueOverview(id), serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
