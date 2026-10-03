import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminConsole } from "@/components/fairdrop/AdminConsole";
import { getEvent } from "@/lib/event";
import { organizerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await organizerSession())) redirect("/admin");
  const { id } = await params;
  if (!(await getEvent(id))) notFound();
  return <div className="min-h-screen bg-slate-50"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5"><Link href="/" className="display text-2xl italic uppercase text-blue-600">Fair Drop<span className="text-slate-900">.</span></Link><span className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Organizer</span></div></header><main className="mx-auto max-w-6xl px-5 py-12"><AdminConsole eventId={id} /></main></div>;
}
