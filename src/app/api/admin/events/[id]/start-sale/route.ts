import { NextResponse } from "next/server";
import { startSale } from "@/lib/queue-operations";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const result = await startSale((await context.params).id);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "EVENT_NOT_FOUND" ? 404 : 409 });
}
