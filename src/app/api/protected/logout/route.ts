import { NextResponse } from "next/server";
import { clearBuyerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST() {
  await clearBuyerSession();
  return NextResponse.json({ ok: true });
}
