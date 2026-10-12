"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

export function OperatorUnlockForm() {
  const router = useRouter();
  const [credential, setCredential] = React.useState("");
  const [configured, setConfigured] = React.useState(true);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/workspace/session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (cancelled) return;
        setConfigured(result.configured !== false);
        setAuthenticated(Boolean(response.ok && result.authenticated));
      })
      .catch(() => {
        if (!cancelled) setError("Workspace status could not be checked. You can still submit the operator key.");
      });
    return () => { cancelled = true; };
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      let sid = "";
      try {
        sid = sessionStorage.getItem("pp_unlock_sid") || "";
        if (!sid) {
          sid = crypto.randomUUID();
          sessionStorage.setItem("pp_unlock_sid", sid);
        }
      } catch { /* sessionStorage unavailable */ }
      const response = await fetch("/api/workspace/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(sid ? { "x-unlock-sid": sid } : {}) },
        body: JSON.stringify({ credential }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        setError(Number.isFinite(retryAfter) && retryAfter > 0
          ? `Too many attempts. Wait ${retryAfter} seconds and try again.`
          : "Too many attempts. Wait a moment and try again.");
        return;
      }
      if (response.status === 503) {
        setConfigured(false);
        setError(typeof result.error === "string" ? result.error : "Set SCRAPER_ADMIN_TOKEN on both application processes before unlocking the workspace");
        return;
      }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Workspace could not be unlocked");
      setCredential("");
      setAuthenticated(true);
      router.push("/workspace");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace could not be unlocked");
    } finally {
      setSubmitting(false);
    }
  }

  if (authenticated) {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950">
        <p className="font-semibold">Operator session is active.</p>
        <Link href="/workspace" className="mt-3 inline-flex h-12 items-center rounded-xl bg-[#0F172A] px-5 text-sm font-semibold text-white hover:bg-[#1E293B]">Open the workspace</Link>
      </div>
    );
  }

  return (
    <form onSubmit={unlock} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <label htmlFor="sign-in-operator-key" className="text-xs font-semibold text-slate-900">
        Operator key <span className="sr-only">(Workspace access key)</span>
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 px-3">
        <KeyRound size={16} className="text-slate-400" />
        <input
          id="sign-in-operator-key"
          required
          disabled={submitting || !configured}
          type="password"
          autoComplete="current-password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
        />
      </div>
      {!configured ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Set SCRAPER_ADMIN_TOKEN on both application processes before unlocking the workspace.</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{error}</p> : null}
      <button disabled={submitting || !configured} className="mt-4 w-full rounded-xl bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50">
        {submitting ? "Unlocking…" : "Unlock workspace"}
      </button>
    </form>
  );
}
