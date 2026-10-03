import { NextResponse } from "next/server";
import { expireEventHolds } from "@/lib/checkout";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  const result = await expireEventHolds((await context.params).id);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
