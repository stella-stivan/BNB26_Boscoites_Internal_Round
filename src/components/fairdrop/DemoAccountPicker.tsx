"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoAccountPicker({ accounts, currentId }: { accounts: { id: string; displayName: string }[]; currentId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function choose(accountId: string) {
    setPending(accountId); setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
      if (!response.ok) throw new Error("Unable to select this demo account.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to select account."); }
    finally { setPending(null); }
  }
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {accounts.map((account) => <button key={account.id} type="button" onClick={() => choose(account.id)} disabled={!!pending}
      className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors ${currentId === account.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white hover:border-blue-400"}`}>
      <span className="block">{account.displayName}</span><span className="text-xs font-normal text-slate-500">{pending === account.id ? "Selecting…" : currentId === account.id ? "Selected" : "Demo buyer"}</span>
    </button>)}
    {error && <p role="alert" className="col-span-full text-sm text-red-700">{error}</p>}
  </div>;
}
