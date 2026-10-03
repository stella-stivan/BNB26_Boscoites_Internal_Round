import { NextResponse } from "next/server";
import { runFairnessLab, validateLabConfig } from "@/lib/fairness-lab";
import { organizerSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) return NextResponse.json({ reasonCode: "UNAUTHORIZED" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ reasonCode: "INVALID_BODY" }, { status: 400 }); }
  const config = validateLabConfig(body);
  if (!config) return NextResponse.json({ reasonCode: "INVALID_CONFIG", message: "Use a 3–40 character seed, 6–24 buyers, 1–population tickets, and concurrency 1–8." }, { status: 400 });
  const { id } = await context.params;
  const incoming = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(incoming.hostname);
  const baseUrl = process.env.LAB_BASE_URL ?? (local ? incoming.origin : null);
  if (!baseUrl) return NextResponse.json({ reasonCode: "LAB_LOCAL_ONLY", message: "Set LAB_BASE_URL to an internal application origin for this deployment." }, { status: 503 });
  const result = await runFairnessLab(id, config, baseUrl);
  return NextResponse.json(result, { status: result.ok ? 200 : result.reasonCode === "EVENT_NOT_FOUND" ? 404 : 500, headers: { "Cache-Control": "no-store" } });
}
