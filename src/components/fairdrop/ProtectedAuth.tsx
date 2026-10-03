"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const TEST_SITE_KEY = "1x00000000000000000000AA";

export function ProtectedAuth({ eventId, siteKey, signedInName }: { eventId: string; siteKey: string | null; signedInName: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"claim" | "login">("claim");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = mode === "claim" ? {
      code: values.get("code"), username: values.get("username"), password: values.get("password"),
      challengeToken: values.get("cf-turnstile-response"),
    } : { username: values.get("username"), password: values.get("password") };
    try {
      const response = await fetch(`/api/protected/events/${eventId}/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.reasonCode ?? "Sign-in failed.");
      form.reset();
      router.refresh();
      setMessage(result.reviewRequired ? "Invitation claimed. The organizer must review your eligibility before you join." : "Signed in. You can now join the waiting room.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to continue.");
      (window as Window & { turnstile?: { reset: () => void } }).turnstile?.reset();
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await fetch("/api/protected/logout", { method: "POST" }); router.refresh(); }
    finally { setBusy(false); }
  }

  if (signedInName) return <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-blue-950"><p className="font-bold">Signed in as {signedInName}</p><p className="mt-2 text-sm">Your invitation is bound to this attendee account. Refreshing keeps your entry.</p><button type="button" onClick={() => void signOut()} disabled={busy} className="mt-4 text-sm font-bold underline disabled:opacity-50">Sign out or switch account</button></div>;
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    {siteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />}
    <div className="flex gap-2 border-b border-slate-200 pb-4"><button type="button" onClick={() => { setMode("claim"); setMessage(""); }} className={`rounded-lg px-4 py-2 text-sm font-bold ${mode === "claim" ? "bg-blue-600 text-white" : "text-slate-600"}`}>Claim invitation</button><button type="button" onClick={() => { setMode("login"); setMessage(""); }} className={`rounded-lg px-4 py-2 text-sm font-bold ${mode === "login" ? "bg-blue-600 text-white" : "text-slate-600"}`}>Sign in</button></div>
    <form onSubmit={submit} className="mt-5 space-y-4" key={mode}>
      {mode === "claim" && <label className="block text-sm font-semibold">Invitation code<input name="code" required autoComplete="off" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 font-mono" placeholder="FD-…" /></label>}
      <label className="block text-sm font-semibold">Username<input name="username" required minLength={3} maxLength={32} autoComplete="username" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></label>
      <label className="block text-sm font-semibold">Password<input name="password" type="password" required minLength={mode === "claim" ? 10 : undefined} autoComplete={mode === "claim" ? "new-password" : "current-password"} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></label>
      {mode === "claim" && <div><p className="mb-2 text-sm text-slate-600">Complete the bot challenge.</p>{siteKey ? <div className="cf-turnstile" data-sitekey={siteKey} data-action="claim-invitation" /> : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Challenge keys must be configured by the organizer.</p>}{siteKey === TEST_SITE_KEY && <p className="mt-2 text-xs text-amber-800">Demo challenge key: this tests the flow and does not block real bots.</p>}</div>}
      <button type="submit" disabled={busy || (mode === "claim" && !siteKey)} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "Working…" : mode === "claim" ? "Claim and create account" : "Sign in"}</button>
      {message && <p role="alert" className="text-sm font-semibold text-blue-900">{message}</p>}
    </form>
  </div>;
}
