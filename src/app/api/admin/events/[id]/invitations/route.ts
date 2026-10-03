import { NextResponse } from "next/server";
import { getEvent } from "@/lib/event";
import { issueInvitation, protectedOverview } from "@/lib/protected-sale";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event || event.access_mode !== "PROTECTED") return NextResponse.json({ reasonCode: "PROTECTED_EVENT_REQUIRED" }, { status: 404 });
  return NextResponse.json({ people: await protectedOverview(id) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 }); }
  const data = body && typeof body === "object" ? body as { reference?: unknown; label?: unknown } : {};
  if (typeof data.reference !== "string" || typeof data.label !== "string") return NextResponse.json({ reasonCode: "INVALID_ATTENDEE" }, { status: 400 });
  const result = await issueInvitation((await context.params).id, data.reference, data.label);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "INVALID_ATTENDEE" ? 400 : 409, headers: { "Cache-Control": "no-store" } });
}
