import { NextResponse } from "next/server";
import { getEvent } from "@/lib/event";
import { labHistory } from "@/lib/fairness-lab";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const { id } = await context.params;
  if (!(await getEvent(id))) return NextResponse.json({ reasonCode: "EVENT_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ runs: await labHistory(id) }, { headers: { "Cache-Control": "no-store" } });
}
