import { NextResponse } from "next/server";
import { admitNext } from "@/lib/queue-operations";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    return NextResponse.json({ reasonCode: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key of 8 to 128 characters." }, { status: 400 });
  }
  const result = await admitNext((await context.params).id, key);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "EVENT_NOT_FOUND" ? 404 : 409 });
}
