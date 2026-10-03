"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Person = { id: string; label: string; reviewState: string; reviewReason: string | null; invitations: number; claims: number; entries: number };

export function ProtectedAdmin({ eventId, mode }: { eventId: string; mode: "DEMO" | "PROTECTED" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const createKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (mode !== "PROTECTED") return;
    const response = await fetch(`/api/admin/events/${eventId}/invitations`, { cache: "no-store" });
    if (response.ok) setPeople((await response.json()).people);
  }, [eventId, mode]);
  useEffect(() => { void load(); }, [load]);

  async function createEvent() {
    setPending(true); setNotice("");
    createKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/admin/events/${eventId}/create-protected`, {
        method: "POST", headers: { "Idempotency-Key": createKey.current },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode);
      createKey.current = null;
      router.push(`/admin/events/${result.eventId}`); router.refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Unable to create event."); }
    finally { setPending(false); }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setNotice(""); setNewCode(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: values.get("reference"), label: values.get("label") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode);
      setNewCode(result.code);
      setNotice(result.duplicateIdentity ? "This reference belongs to an existing attendee. The new code cannot create a second account for them." : "Invitation issued. Copy it now; the code is shown only once.");
      form.reset(); await load();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Unable to issue invitation."); }
    finally { setPending(false); }
  }

  async function review(personId: string, state: "APPROVED" | "BLOCKED") {
    setPending(true); setNotice("");
    try {
      const response = await fetch(`/api/admin/events/${eventId}/people/${personId}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode);
      setNotice(`Attendee ${state.toLowerCase()}.`); await load();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Review failed."); }
    finally { setPending(false); }
  }

  if (mode === "DEMO") return <section className="mt-7 rounded-2xl border border-blue-200 bg-blue-50 p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-700">Account-farming defense</p><h2 className="mt-2 text-xl font-bold">Start a protected sale</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700">Create a separate event where organizer-issued invitations bind buyers to one attendee identity. This does not change the current open demo sale.</p><button type="button" disabled={pending} onClick={() => void createEvent()} className="mt-4 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Create protected event</button>{notice && <p role="alert" className="mt-3 text-sm text-red-800">{notice}</p>}</section>;

  return <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Invitation control</p><h2 className="mt-2 text-xl font-bold">Verified attendee invitations</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Use an organizer-verified attendee reference, such as a registration ID. One person can hold only one account, queue entry, and order for this event.</p></div><Link href={`/protected/${eventId}`} className="rounded-lg border border-blue-300 px-4 py-3 text-sm font-bold text-blue-700">Open buyer page ↗</Link></div>
    <form onSubmit={issue} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-sm font-semibold">Attendee reference<input name="reference" required minLength={3} maxLength={120} placeholder="Registration ID" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></label><label className="text-sm font-semibold">Display label<input name="label" required minLength={2} maxLength={80} placeholder="Attendee A" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></label><button type="submit" disabled={pending} className="self-end rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Issue invitation</button></form>
    {newCode && <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4"><p className="text-sm font-bold text-green-900">Copy this code now</p><p className="mt-2 break-all font-mono text-lg text-green-950">{newCode}</p><button type="button" onClick={() => void navigator.clipboard.writeText(newCode)} className="mt-2 text-sm font-bold text-green-800 underline">Copy code</button></div>}
    {notice && <p role="status" className="mt-4 text-sm font-semibold text-blue-900">{notice}</p>}
    <div className="mt-7 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Attendee</th><th className="px-3 py-3">Review</th><th className="px-3 py-3">Codes</th><th className="px-3 py-3">Claims</th><th className="px-3 py-3">Entries</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{people.map((person) => <tr key={person.id} className="border-t border-slate-100"><td className="px-3 py-3 font-semibold">{person.label}</td><td className="px-3 py-3">{person.reviewState.replaceAll("_", " ")}{person.reviewReason ? <span className="block text-xs text-amber-700">{person.reviewReason.replaceAll("_", " ")}</span> : null}</td><td className="px-3 py-3">{person.invitations}</td><td className="px-3 py-3">{person.claims}</td><td className="px-3 py-3">{person.entries}</td><td className="px-3 py-3"><div className="flex gap-3"><button type="button" disabled={pending || person.reviewState === "APPROVED"} onClick={() => void review(person.id, "APPROVED")} className="font-bold text-green-700 disabled:opacity-30">Approve</button><button type="button" disabled={pending || person.reviewState === "BLOCKED"} onClick={() => void review(person.id, "BLOCKED")} className="font-bold text-red-700 disabled:opacity-30">Block</button></div></td></tr>)}</tbody></table>{people.length === 0 && <p className="p-4 text-sm text-slate-500">No attendee invitations yet.</p>}</div>
  </section>;
}
