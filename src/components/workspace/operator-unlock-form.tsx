"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";

export function OperatorUnlockForm() {
  const { messages, format } = useLocale();
  const t = messages.operatorUnlock;
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
        if (!cancelled) setError(t.statusCheckFallback);
      });
    return () => { cancelled = true; };
  }, [t.statusCheckFallback]);

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
          ? format(t.rateLimitWithSeconds, { seconds: retryAfter })
          : t.rateLimitGeneric);
        return;
      }
      if (response.status === 503) {
        setConfigured(false);
        setError(typeof result.error === "string" ? result.error : t.configMissingHint);
        return;
      }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : t.unlockFailedFallback);
      setCredential("");
      setAuthenticated(true);
      router.push("/workspace");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.unlockFailedFallback);
    } finally {
      setSubmitting(false);
    }
  }

  if (authenticated) {
    return (
      <div className="mt-6 rounded-card border border-go/30 bg-go-wash p-6 text-sm text-ink">
        <p className="font-semibold">{t.activeSessionNotice}</p>
        <Link href="/workspace" className="mt-3 inline-flex h-12 items-center rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2">{t.openWorkspaceLink}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={unlock} className="mt-6 rounded-card border border-line bg-card p-6 shadow-sm">
      <label htmlFor="sign-in-operator-key" className="text-xs font-semibold text-ink">
        {t.keyLabel} <span className="sr-only">{t.keySrSuffix}</span>
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-control border border-line-strong bg-card px-3 focus-within:border-yours focus-within:ring-2 focus-within:ring-yours/20">
        <KeyRound size={16} className="text-ink-3" />
        <input
          id="sign-in-operator-key"
          required
          disabled={submitting || !configured}
          type="password"
          autoComplete="current-password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none focus-visible:shadow-none"
        />
      </div>
      {!configured ? <p className="mt-3 rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">{t.configMissingHint}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">{error}</p> : null}
      <button disabled={submitting || !configured} className="mt-4 w-full rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50">
        {submitting ? t.unlockingBtn : t.unlockBtn}
      </button>
    </form>
  );
}
