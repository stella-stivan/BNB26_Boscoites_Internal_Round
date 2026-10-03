import { ArrowRight, Clock3, ShieldCheck, Ticket, UsersRound } from "lucide-react";
import { BuyerCTA } from "@/components/fairdrop/BuyerCTA";
import { DemoAccountPicker } from "@/components/fairdrop/DemoAccountPicker";
import { LandingHeader } from "@/components/fairdrop/LandingHeader";
import { getSeedEventId } from "@/lib/db";
import { getBuyerState, getDemoAccounts, getEvent } from "@/lib/event";
import { buyerAccountId } from "@/lib/session";

export const dynamic = "force-dynamic";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

export default async function Home() {
  const eventId = await getSeedEventId();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Demo event is missing");
  const [buyer, accounts] = await Promise.all([getBuyerState(event.id, await buyerAccountId()), getDemoAccounts()]);

  return <>
    <LandingHeader event={event} buyer={buyer} />
    <main>
      <section id="event" className="bg-blue-600 text-white">
        <div className="hero-photo relative flex min-h-[370px] items-start justify-end px-6 py-8 sm:min-h-[480px] lg:min-h-[550px] lg:px-12">
          <div className="rounded-full border border-white/30 bg-slate-950/35 px-4 py-2 text-xs font-bold uppercase tracking-[.18em] backdrop-blur">Live prototype sale · 500 seats</div>
        </div>
        <div className="mx-auto max-w-7xl px-5 pb-16 pt-2 md:px-8 lg:pb-24">
          <div className="display text-[clamp(4.5rem,13vw,12rem)] leading-[.82] uppercase italic">Fair</div>
          <div className="display text-right text-[clamp(4.5rem,13vw,12rem)] leading-[.82] uppercase italic">Drop.</div>
          <div className="mt-12 grid gap-10 border-t border-white/30 pt-9 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[.2em] text-blue-100">One fair entry per account</p>
              <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">500 seats. A waiting room built for everyone.</h1>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-blue-50">Join during the entry window. Your place is assigned once the window closes, so repeated clicks cannot move you ahead.</p>
              <div className="mt-7"><BuyerCTA event={event} buyer={buyer} light /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[410px]">
              <div className="border border-white/30 bg-blue-700/50 p-5"><span className="text-xs font-bold uppercase tracking-[.15em] text-blue-100">Entry closes</span><p className="mt-2 text-lg font-bold tabular">{formatTime(event.entry_closes_at)}</p><p className="mt-1 text-xs text-blue-100">India Standard Time</p></div>
              <div className="border border-white/30 bg-blue-700/50 p-5"><span className="text-xs font-bold uppercase tracking-[.15em] text-blue-100">Current status</span><p className="mt-2 text-lg font-bold">{event.status === "ENTRY_OPEN" ? "Entry open" : event.status.replaceAll("_", " ").toLowerCase()}</p><p className="mt-1 text-xs text-blue-100">From the event server</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 md:px-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="text-sm font-bold uppercase tracking-[.2em] text-blue-600">The event</p>
          <h2 className="display mt-4 max-w-lg text-5xl leading-[1.02] sm:text-6xl">One ticket. One clear path in.</h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">This is a simulated ticket sale. The server keeps each buyer&apos;s entry and queue position, admits buyers in controlled batches, and holds one ticket during checkout. No real payment is taken.</p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold"><span className="rounded-full border border-slate-200 bg-white px-4 py-2">One demo ticket per account</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2">Late entries close at cutoff</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2">No real payment</span></div>
        </div>
        <div className="lift self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-slate-900 px-7 py-5 text-white"><span className="text-xs font-bold uppercase tracking-[.18em]">Ticket summary</span><Ticket className="h-5 w-5" /></div>
          <div className="p-7"><p className="text-sm font-semibold text-slate-500">Fair Drop demo ticket</p><p className="display mt-2 text-5xl">1 seat</p><div className="my-7 h-px bg-slate-200" /><dl className="space-y-4 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Total inventory</dt><dd className="font-bold tabular">{event.total_inventory}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Available now</dt><dd className="font-bold tabular">{event.available}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Hold after admission</dt><dd className="font-bold tabular">{Math.round(event.reservation_ttl_seconds / 60)} minutes</dd></div></dl><p className="mt-7 rounded-lg bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">A queue position determines admission order; it does not reserve a ticket.</p></div>
        </div>
      </section>

      <section id="how-it-works" className="bg-white py-20"><div className="mx-auto max-w-7xl px-5 md:px-8"><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-600">How it works</p><h2 className="display mt-4 text-5xl sm:text-6xl">A fairer way to get in.</h2><div className="mt-12 grid gap-5 md:grid-cols-3">
        {[
          { n: "01", icon: <Clock3 />, title: "Enter the window", text: "Join while entry is open. Refreshing or trying again returns your existing entry." },
          { n: "02", icon: <UsersRound />, title: "Get one position", text: "After entry closes, the server assigns one random order to eligible accounts." },
          { n: "03", icon: <ShieldCheck />, title: "Move through the queue", text: "Buyers are admitted in batches. A short hold gives admitted buyers time to check out." },
        ].map((step) => <article key={step.n} className="rounded-2xl border border-slate-200 bg-slate-50 p-7"><div className="flex items-center justify-between text-blue-600"><span className="display text-4xl">{step.n}</span>{step.icon}</div><h3 className="mt-8 text-xl font-bold">{step.title}</h3><p className="mt-3 leading-relaxed text-slate-600">{step.text}</p></article>)}
      </div></div></section>

      <section id="demo-account" className="mx-auto max-w-7xl px-5 py-20 md:px-8"><div className="grid gap-9 rounded-2xl bg-slate-900 p-7 text-white sm:p-10 lg:grid-cols-[.8fr_1.2fr] lg:p-14"><div><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-300">Try the prototype</p><h2 className="display mt-4 text-4xl sm:text-5xl">Choose a demo buyer.</h2><p className="mt-5 leading-relaxed text-slate-300">These accounts demonstrate one entry per account. They do not verify that an account belongs to one person.</p></div><div className="self-center rounded-xl bg-white p-5 text-slate-900 sm:p-7"><p className="mb-4 text-sm font-bold">{buyer.account ? `Signed in as ${buyer.account.displayName}` : "Select a buyer to continue"}</p><DemoAccountPicker accounts={accounts} currentId={buyer.account?.id ?? null} /></div></div></section>

      <section id="faq" className="bg-white py-20"><div className="mx-auto max-w-5xl px-5 md:px-8"><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-600">Answers first</p><h2 className="display mt-4 text-5xl">Queue FAQ.</h2><div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">{[
        ["Can I refresh or come back later?", "Yes. Your account's queue entry is stored on the server. The status page loads it again whenever you return."],
        ["Will repeated joins improve my chances?", "No. The same account receives one eligible queue entry. A retry returns that existing entry."],
        ["When is my position assigned?", "After the entry window closes. Eligible entries are ordered once; speed within the window does not set your position."],
        ["Does a queue position guarantee a ticket?", "No. A position controls admission order. A ticket is only held after a successful reservation."],
      ].map(([question, answer]) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">{question}<ArrowRight className="h-5 w-5 shrink-0 text-blue-600 transition-transform group-open:rotate-90" /></summary><p className="max-w-3xl pt-3 leading-relaxed text-slate-600">{answer}</p></details>)}</div></div></section>
      <section className="bg-blue-600 px-5 py-20 text-center text-white"><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-100">Ready when you are</p><h2 className="display mx-auto mt-4 max-w-3xl text-5xl sm:text-6xl">One entry is all you need.</h2><div className="mt-8 flex justify-center"><BuyerCTA event={event} buyer={buyer} light /></div></section>
    </main>
    <footer className="bg-slate-950 px-5 py-8 text-sm text-slate-300"><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3"><span className="font-bold text-white">FAIR DROP.</span><span>Hackathon prototype · simulated checkout · no real tickets</span></div></footer>
  </>;
}
