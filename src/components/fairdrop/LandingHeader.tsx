"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import type { EventRow, BuyerState } from "@/lib/event";
import { BuyerCTA } from "./BuyerCTA";

const links = [{ label: "Event", href: "#event" }, { label: "How it works", href: "#how-it-works" }, { label: "FAQ", href: "#faq" }, { label: "My status", href: "/queue" }];

export function LandingHeader({ event, buyer }: { event: EventRow; buyer: BuyerState }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); } }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-6 px-5 md:px-8">
      <Link href="/" className="display text-2xl italic uppercase text-blue-600">Fair Drop<span className="text-slate-900">.</span></Link>
      <nav aria-label="Main navigation" className="hidden items-center gap-7 text-sm font-semibold text-slate-700 lg:flex">{links.map((link) => <Link key={link.label} href={link.href} className="hover:text-blue-600">{link.label}</Link>)}</nav>
      <div className="hidden lg:block"><BuyerCTA event={event} buyer={buyer} /></div>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)} className="rounded p-2 lg:hidden">{open ? <X /> : <Menu />}</button>
    </div>
    {open && <nav id="mobile-nav" aria-label="Mobile navigation" className="border-t border-slate-200 bg-white px-5 pb-5 lg:hidden">
      {links.map((link) => <Link key={link.label} href={link.href} onClick={() => { setOpen(false); toggle.current?.focus(); }} className="block border-b border-slate-100 py-3 font-semibold">{link.label}</Link>)}
      <div className="pt-4"><BuyerCTA event={event} buyer={buyer} /></div>
    </nav>}
  </header>;
}
