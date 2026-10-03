import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/fairdrop/AdminLogin";
import { getSeedEventId } from "@/lib/db";
import { organizerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authorized = await organizerSession();
  if (authorized) redirect(`/admin/events/${await getSeedEventId()}`);
  return <div className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5"><Link href="/" className="display text-2xl italic uppercase text-blue-600">Fair Drop<span className="text-slate-900">.</span></Link><span className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Organizer</span></div></header>
    <main className="mx-auto max-w-6xl px-5 py-12"><AdminLogin /></main>
  </div>;
}
