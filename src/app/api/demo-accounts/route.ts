import { NextResponse } from "next/server";
import { getDemoAccounts } from "@/lib/event";
import { getSeedEventId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const [accounts, eventId] = await Promise.all([getDemoAccounts(), getSeedEventId()]);
  return NextResponse.json({ accounts, eventId });
}
