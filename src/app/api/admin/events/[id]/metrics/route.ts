import { NextResponse } from "next/server";
import { eventMetrics } from "@/lib/organizer";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const metrics = await eventMetrics((await context.params).id);
  if (!metrics) return NextResponse.json({ reasonCode: "EVENT_NOT_FOUND" }, { status: 404 });
  return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } });
}
