"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BuyerState, EventRow } from "@/lib/event";
import { getBuyerAction } from "@/lib/buyer-action";

export function BuyerCTA({ event, buyer, light = false, queueHref = "/queue", authHref = "#demo-account" }: { event: EventRow; buyer: BuyerState; light?: boolean; queueHref?: string; authHref?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const action = getBuyerAction(event, buyer);
  const cls = `inline-flex min-h-12 items-center justify-center px-6 py-3 text-sm font-bold uppercase tracking-[.12em] transition-colors ${light ? "bg-white text-blue-700 hover:bg-blue-50" : "bg-blue-600 text-white hover:bg-blue-700"}`;

  async function join() {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/events/${event.id}/join`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.reasonCode ?? "Unable to join");
      router.push(queueHref);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to join");
    } finally { setPending(false); }
  }

  return <span className="inline-flex flex-col items-start gap-2">
    {action.href ? <Link href={action.href === "/queue" ? queueHref : action.href === "#demo-account" ? authHref : action.href} className={cls}>{buyer.state === "NOT_SIGNED_IN" && event.access_mode === "PROTECTED" ? "Claim invitation or sign in" : action.label} <span aria-hidden className="ml-3">↗</span></Link>
      : <button type="button" onClick={join} disabled={pending || action.disabled} className={`${cls} disabled:opacity-60`}>{pending ? "Joining…" : action.label} <span aria-hidden className="ml-3">↗</span></button>}
    {error && <span role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</span>}
  </span>;
}
