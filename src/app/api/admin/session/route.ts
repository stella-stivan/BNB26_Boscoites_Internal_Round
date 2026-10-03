import { NextResponse } from "next/server";
import { setOrganizerSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.ADMIN_SECRET) return NextResponse.json({ reasonCode: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_REQUEST" }, { status: 400 }); }
  const secret = typeof body === "object" && body !== null && "secret" in body ? (body as { secret: unknown }).secret : null;
  if (typeof secret !== "string" || secret !== process.env.ADMIN_SECRET) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 401 });
  await setOrganizerSession();
  return NextResponse.json({ ok: true });
}
