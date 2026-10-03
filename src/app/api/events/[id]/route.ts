import { NextResponse } from "next/server";
import { getEvent } from "@/lib/event";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ reasonCode: "EVENT_NOT_FOUND", message: "Event not found." }, { status: 404 });
  return NextResponse.json({ event, serverTime: new Date().toISOString() });
}
