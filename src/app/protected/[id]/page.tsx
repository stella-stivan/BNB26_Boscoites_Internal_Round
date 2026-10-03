import Link from "next/link";
import { notFound } from "next/navigation";
import { BuyerCTA } from "@/components/fairdrop/BuyerCTA";
import { ProtectedAuth } from "@/components/fairdrop/ProtectedAuth";
import { getBuyerState, getEvent } from "@/lib/event";
import { buyerAccountId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProtectedEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event || event.access_mode !== "PROTECTED") notFound();
  const buyer = await getBuyerState(id, await buyerAccountId());
  const queueHref = `/protected/${id}/queue`;
  return <div className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5"><Link href="/" className="display text-2xl italic uppercase text-blue-600">Fair Drop<span className="text-slate-900">.</span></Link><span className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Protected sale demo</span></div></header>
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20"><div className="grid gap-10 lg:grid-cols-[1.1fr_.9fr]"><div><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-600">Invitation-backed sale</p><h1 className="display mt-4 text-5xl leading-none sm:text-7xl">One attendee.<br />One chance.</h1><p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">An organizer issues each invitation to an attendee they verified. The attendee claims it, signs in, and receives one queue entry even if another account tries to use the same identity.</p><div className="mt-7 flex flex-wrap gap-3 text-sm font-semibold"><span className="rounded-full border border-slate-200 bg-white px-4 py-2">{event.total_inventory} demo tickets</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2">{event.status.replaceAll("_", " ")}</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2">No real payment</span></div><div className="mt-8"><BuyerCTA event={event} buyer={buyer} queueHref={queueHref} authHref="#protected-auth" /></div>{buyer.account && <p className="mt-4 text-sm text-slate-600">{buyer.message}</p>}<div className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950"><strong>Demo identity rule:</strong> This site trusts the organizer&apos;s attendee list. A shared or improperly issued invitation does not prove a real person&apos;s identity.</div></div><section id="protected-auth"><h2 className="mb-4 text-xl font-bold">Attendee access</h2><ProtectedAuth eventId={id} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null} signedInName={buyer.account?.displayName ?? null} /></section></div></main>
  </div>;
}
