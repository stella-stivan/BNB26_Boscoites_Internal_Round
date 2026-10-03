import { NextResponse } from "next/server";
import { reviewProtectedPerson } from "@/lib/protected-sale";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; personId: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 }); }
  const state = body && typeof body === "object" && "state" in body ? (body as { state: unknown }).state : null;
  if (state !== "APPROVED" && state !== "BLOCKED") return NextResponse.json({ reasonCode: "INVALID_REVIEW_STATE" }, { status: 400 });
  const { id, personId } = await context.params;
  const result = await reviewProtectedPerson(id, personId, state);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "REVIEW_LOCKED" ? 409 : 404 });
}
