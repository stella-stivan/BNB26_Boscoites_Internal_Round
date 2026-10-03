"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow } from "@/lib/event";
import { ProtectedAdmin } from "./ProtectedAdmin";
import Link from "next/link";

type Overview = { event: EventRow; queue: { entries: { displayName: string; position: number | null; state: string; admissionExpiresAt: string | null }[] } };
type Metrics = {
  inventory: { total: number; available: number; reserved: number; sold: number; balanced: boolean };
  queue: { depth: number; admitted: number; reserved: number; confirmed: number; expired: number };
  reservations: { active: number; confirmed: number; expired: number };
  orders: number; throttledRequests: number; errorRequests: number;
  abuse: { duplicatePeople: number; challengeFailures: number; invalidInvitations: number };
  recentDecisions: { id: string; type: string; reasonCode: string | null; occurredAt: string }[];
};
type Operation = "open-entry" | "close-entry" | "start-sale" | "admit" | "expire-holds";

export function AdminConsole({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const resetKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    const [stateResponse, metricsResponse] = await Promise.all([
      fetch(`/api/admin/events/${eventId}`, { cache: "no-store" }),
      fetch(`/api/admin/events/${eventId}/metrics`, { cache: "no-store" }),
    ]);
    if (!stateResponse.ok || !metricsResponse.ok) throw new Error("Unable to load organizer state.");
    setOverview(await stateResponse.json());
    setMetrics(await metricsResponse.json());
  }, [eventId]);
  useEffect(() => {
    void load().catch(() => setNotice("Unable to load organizer state."));
    const interval = window.setInterval(() => { void load().catch(() => setNotice("Unable to refresh organizer state.")); }, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function act(operation: Operation) {
    setPending(operation); setNotice("");
    try {
      const response = await fetch(`/api/admin/events/${eventId}/${operation}`, {
        method: "POST", headers: operation === "admit" ? { "Idempotency-Key": crypto.randomUUID() } : {},
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode ?? "Operation failed");
      setNotice(operation === "admit" ? `${result.admitted.length} buyer(s) admitted. ${result.activeAdmissions} active admission(s).`
        : operation === "expire-holds" ? `${result.expired} expired hold(s) released.`
          : result.reasonCode.replaceAll("_", " ").toLowerCase());
      await load();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Operation failed."); }
    finally { setPending(null); }
  }

  async function resetDemo() {
    setPending("reset-demo"); setNotice("");
    resetKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/admin/events/${eventId}/reset-demo`, {
        method: "POST", headers: { "Idempotency-Key": resetKey.current },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode ?? "Reset failed");
      resetKey.current = null;
      router.push(`/admin/events/${result.eventId}`);
      router.refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Reset failed. Retry uses the same key."); }
    finally { setPending(null); }
  }

  const event = overview?.event;
  const queue = metrics?.queue;
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Organizer console · Phase 4</p><h1 className="display mt-3 text-4xl sm:text-5xl">Sale control.</h1></div>
      <div className="flex items-center gap-3"><Link href={`/admin/events/${eventId}/lab`} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700">Fairness Lab ↗</Link><span className="rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">{event?.status.replaceAll("_", " ") ?? "Loading"}</span></div>
    </div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Available" value={metrics?.inventory.available ?? 0} />
      <Metric label="Held" value={metrics?.inventory.reserved ?? 0} />
      <Metric label="Sold" value={metrics?.inventory.sold ?? 0} />
      <Metric label="Queued" value={queue?.depth ?? 0} />
      <Metric label="Admitted" value={queue?.admitted ?? 0} />
      <Metric label="Orders" value={metrics?.orders ?? 0} />
    </div>
    <div className={`mt-4 rounded-xl border p-4 text-sm font-bold ${metrics?.inventory.balanced ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      Inventory invariant: {metrics ? metrics.inventory.balanced ? "PASS" : "FAIL" : "Loading"} · {metrics?.inventory.available ?? "—"} available + {metrics?.inventory.reserved ?? "—"} held + {metrics?.inventory.sold ?? "—"} sold = {metrics?.inventory.total ?? "—"} total
    </div>
    {event && <ProtectedAdmin eventId={eventId} mode={event.access_mode} />}
    <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">Sale controls</h2>
        <p className="mt-2 text-sm text-slate-600">Close entry to freeze and order the eligible group. Start the sale before admitting a batch.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Control label="Open entry" disabled={!event || event.status !== "DRAFT" || !!pending} onClick={() => act("open-entry")} />
          <Control label="Close & order entry" disabled={!event || event.status !== "ENTRY_OPEN" || !!pending} onClick={() => act("close-entry")} />
          <Control label="Start sale" disabled={!event || event.status !== "ENTRY_CLOSED" || !!pending} onClick={() => act("start-sale")} />
          <Control label="Admit next batch" disabled={!event || event.status !== "SELLING" || !!pending} onClick={() => act("admit")} primary />
          <Control label="Release expired holds" disabled={!event || !!pending} onClick={() => act("expire-holds")} />
        </div>
        <p aria-live="polite" className="mt-5 min-h-6 text-sm font-semibold text-blue-700">{notice || (pending ? "Working…" : "")}</p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">Published policy</h2>
        <dl className="mt-5 space-y-3 text-sm">
          <Info label="Ordering" value="Random order once at entry close" />
          <Info label="Late entry" value="Closed after cutoff" />
          <Info label="Policy version" value={event?.queue_policy_version ?? "—"} />
          <Info label="Eligible entries" value={String(event?.ordered_count ?? "Pending")} />
          <Info label="Batch capacity" value={String(event?.batch_size ?? "—")} />
          <Info label="Admission window" value={event ? `${event.admission_ttl_seconds} seconds` : "—"} />
          <Info label="Ordered at" value={event?.ordered_at ? new Date(event.ordered_at).toLocaleString() : "Not yet ordered"} />
        </dl>
      </section>
    </div>
    <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">Requests and holds</h2>
        <dl className="mt-5 space-y-3 text-sm">
          <Info label="Throttled requests" value={String(metrics?.throttledRequests ?? 0)} />
          <Info label="Rejected requests" value={String(metrics?.errorRequests ?? 0)} />
          <Info label="Active holds" value={String(metrics?.reservations.active ?? 0)} />
          <Info label="Expired holds" value={String(metrics?.reservations.expired ?? 0)} />
          <Info label="Expired queue entries" value={String(queue?.expired ?? 0)} />
          {event?.access_mode === "PROTECTED" && <><Info label="Duplicate attendee attempts" value={String(metrics?.abuse.duplicatePeople ?? 0)} /><Info label="Invalid invitation attempts" value={String(metrics?.abuse.invalidInvitations ?? 0)} /><Info label="Challenge failures" value={String(metrics?.abuse.challengeFailures ?? 0)} /></>}
        </dl>
        {event?.access_mode === "DEMO" && <div className="mt-8 border-t border-slate-200 pt-6"><h3 className="font-bold">Fresh demo event</h3><p className="mt-2 text-sm text-slate-600">Creates a new empty event and makes it the landing page demo. Earlier events, orders, audits, and simulation results stay available.</p><button type="button" disabled={!!pending} onClick={() => void resetDemo()} className="mt-4 rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold hover:border-blue-500 disabled:opacity-40">Start fresh demo</button></div>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">Recent decisions</h2>
        <ul className="mt-5 max-h-80 space-y-3 overflow-auto text-sm">{metrics?.recentDecisions.map((decision) => <li key={decision.id} className="border-b border-slate-100 pb-3"><p className="font-semibold">{decision.type.replaceAll("_", " ")}</p><p className="text-slate-500">{decision.reasonCode ?? "—"} · {new Date(decision.occurredAt).toLocaleString()}</p></li>)}</ul>
        {metrics && metrics.recentDecisions.length === 0 && <p className="mt-5 text-sm text-slate-500">No decisions yet.</p>}
      </section>
    </div>
    <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-6"><h2 className="text-xl font-bold">Queue entries</h2><p className="mt-1 text-sm text-slate-500">Positions stay fixed after close. Admissions use the next waiting positions.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-6 py-3">Position</th><th className="px-6 py-3">Buyer</th><th className="px-6 py-3">State</th><th className="px-6 py-3">Admission ends</th></tr></thead><tbody>{overview?.queue.entries.map((entry, index) => <tr key={`${entry.displayName}-${index}`} className="border-t border-slate-100"><td className="px-6 py-4 font-bold tabular">{entry.position ?? "Pending"}</td><td className="px-6 py-4">{entry.displayName}</td><td className="px-6 py-4">{entry.state}</td><td className="px-6 py-4 tabular">{entry.admissionExpiresAt ? new Date(entry.admissionExpiresAt).toLocaleTimeString() : "—"}</td></tr>)}</tbody></table>{overview && overview.queue.entries.length === 0 && <p className="p-6 text-sm text-slate-500">No buyers have joined yet.</p>}</div>
    </section>
  </>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="display mt-2 text-4xl tabular">{value}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 border-b border-slate-100 pb-2"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>; }
function Control({ label, disabled, onClick, primary = false }: { label: string; disabled: boolean; onClick: () => void; primary?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-40 ${primary ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 bg-white hover:border-blue-500"}`}>{label}</button>; }
