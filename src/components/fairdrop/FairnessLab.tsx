"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Cohort = { profile: string; eligible: number; requests: number; allocations: number; allocationRate: number;
  requestToAllocation: number | null; baselineAllocations: number; baselineAllocationRate: number; throttledRequests: number };
type Results = { baseline?: { label: string; winners: number; policy: string }; cohorts?: Cohort[];
  fairDrop?: { allocations: number; acceptedEntries: number; requestCount: number; throttledRequests: number;
    oversells: number; duplicateOrders: number; queueIntegrityViolations: number; reconnectFailures: string[];
    inventory: { available: number; reserved: number; sold: number; total_inventory: number } };
  latencyMs?: { method: string; p50: number | null; p95: number | null }; limitations?: string[]; error?: string };
type Run = { id: string; eventId: string; seed: string; status: string; startedAt: string; completedAt: string | null;
  config: { population: number; inventory: number; maxConcurrency: number; schedule: unknown[] }; results: Results };

export function FairnessLab({ eventId }: { eventId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/events/${eventId}/lab`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load lab runs.");
    setRuns((await response.json()).runs);
  }, [eventId]);
  useEffect(() => { void load().catch(() => setNotice("Unable to load previous runs.")); }, [load]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/lab/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: values.get("seed"), population: Number(values.get("population")),
          inventory: Number(values.get("inventory")), maxConcurrency: Number(values.get("maxConcurrency")) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode ?? "Run failed.");
      setNotice(`Run ${result.runId.slice(0, 8)} completed on an isolated event.`);
      await load();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Run failed."); }
    finally { setBusy(false); }
  }

  return <>
    <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Phase 5 · repeatable evidence</p>
    <h1 className="display mt-3 text-5xl sm:text-6xl">Fairness Lab.</h1>
    <p className="mt-5 max-w-3xl leading-relaxed text-slate-600">Each run creates its own event and logical buyers, then sends join and checkout requests through the buyer HTTP API. The baseline is a first-request-wins model using the same seed, buyers, inventory, and request schedule. It is not a real competitor system.</p>
    <form onSubmit={start} className="mt-8 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
      <Field label="Seed" name="seed" defaultValue="fairdrop-demo-1" type="text" min="" />
      <Field label="Logical buyers" name="population" defaultValue="12" type="number" min="6" max="24" />
      <Field label="Tickets" name="inventory" defaultValue="5" type="number" min="1" max="24" />
      <Field label="Max concurrency" name="maxConcurrency" defaultValue="6" type="number" min="1" max="8" />
      <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Running…" : "Run comparison"}</button>
      <p aria-live="polite" className="text-sm font-semibold text-blue-800 sm:col-span-2 lg:col-span-5">{notice || (busy ? "Simulating traffic. This may take a few seconds." : "")}</p>
    </form>
    <div className="mt-8 space-y-7">{runs.map((run) => <RunCard key={run.id} run={run} />)}
      {!runs.length && <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">No lab runs yet. Start a comparison above.</p>}
    </div>
  </>;
}

function Field({ label, name, defaultValue, type, min, max }: { label: string; name: string; defaultValue: string; type: string; min: string; max?: string }) {
  return <label className="block text-sm font-bold">{label}<input name={name} type={type} min={min || undefined} max={max} minLength={type === "text" ? 3 : undefined} maxLength={type === "text" ? 40 : undefined} required defaultValue={defaultValue} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 font-normal" /></label>;
}
function percent(value: number) { return `${Math.round(value * 100)}%`; }
function RunCard({ run }: { run: Run }) {
  const result = run.results ?? {};
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-6"><div><h2 className="text-xl font-bold">Run {run.id.slice(0, 8)} · {run.status.toLowerCase()}</h2><p className="mt-1 text-sm text-slate-500">{new Date(run.startedAt).toLocaleString()} · seed <span className="font-mono">{run.seed}</span></p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Isolated event {run.eventId?.slice(0, 8)}</span></div>
    <div className="p-6"><p className="text-sm text-slate-600">Configuration: {run.config.population} logical buyers · {run.config.inventory} tickets · at most {run.config.maxConcurrency} concurrent HTTP requests · {run.config.schedule?.length ?? 0} scheduled join requests.</p>
      {result.error && <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{result.error}</p>}
      {result.cohorts && <><div className="mt-6 overflow-x-auto"><table className="w-full min-w-[770px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Profile</th><th className="px-3 py-3">Eligible</th><th className="px-3 py-3">Requests</th><th className="px-3 py-3">Fair Drop wins</th><th className="px-3 py-3">Fair rate</th><th className="px-3 py-3">Requests / win</th><th className="px-3 py-3">Baseline wins</th><th className="px-3 py-3">429s</th></tr></thead><tbody>{result.cohorts.map((row) => <tr key={row.profile} className="border-t border-slate-100"><td className="px-3 py-3 font-semibold">{row.profile.replaceAll("_", " ")}</td><td className="px-3 py-3">{row.eligible}</td><td className="px-3 py-3">{row.requests}</td><td className="px-3 py-3">{row.allocations}</td><td className="px-3 py-3">{percent(row.allocationRate)}</td><td className="px-3 py-3">{row.requestToAllocation?.toFixed(1) ?? "—"}</td><td className="px-3 py-3">{row.baselineAllocations} ({percent(row.baselineAllocationRate)})</td><td className="px-3 py-3">{row.throttledRequests}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Baseline model: {result.baseline?.policy}</p></>}
      {result.fairDrop && <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Accepted entries" value={result.fairDrop.acceptedEntries} /><Metric label="Confirmed orders" value={result.fairDrop.allocations} /><Metric label="Throttled requests" value={result.fairDrop.throttledRequests} /><Metric label="Oversells / duplicate orders / queue violations" value={`${result.fairDrop.oversells} / ${result.fairDrop.duplicateOrders} / ${result.fairDrop.queueIntegrityViolations}`} /></div>}
      {result.latencyMs && <p className="mt-5 text-sm text-slate-600">Buyer API latency: p50 {result.latencyMs.p50 ?? "—"} ms · p95 {result.latencyMs.p95 ?? "—"} ms. {result.latencyMs.method}.</p>}
      <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">Limits of this result</p><ul className="mt-2 list-disc space-y-1 pl-5">{(result.limitations ?? ["This run did not complete."]).map((item) => <li key={item}>{item}</li>)}</ul></div>
    </div>
  </section>;
}
function Metric({ label, value }: { label: string; value: number | string }) { return <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl font-bold tabular">{value}</p></div>; }
