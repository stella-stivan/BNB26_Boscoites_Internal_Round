import { NextResponse } from "next/server";
import { confirmReservation } from "@/lib/checkout";
import { buyerAccountId } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const accountId = await buyerAccountId();
  if (!accountId) return NextResponse.json({ reasonCode: "NOT_SIGNED_IN", message: "Choose a demo account first." }, { status: 401 });
  const result = await confirmReservation((await context.params).id, accountId);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "RESERVATION_NOT_FOUND" ? 404 : 409 });
}
