"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { useLocale } from "@/components/i18n/locale-provider";

export default function UnsubscribePage() {
  const { locale, messages: m } = useLocale();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || pending) return;
    setPending(true);
    setError("");
    setNote("");
    try {
      const response = await fetch("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" && locale === "en" ? body.error : m.accountUi.removalFailed);
      }
      setNote(locale === "en" && typeof body?.message === "string" ? body.message : m.accountUi.removedNote);
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error && locale === "en" ? cause.message : m.accountUi.removalFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16 outline-none">
      <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.accountUi.unsubscribeEyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{m.accountUi.unsubscribeTitle}</h1>
      <p className="mt-4 text-sm leading-6 text-ink-3">
        {m.accountUi.unsubscribeDesc}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-card border border-line bg-card p-6 shadow-sm">
        <label htmlFor="unsubscribe-email" className="block text-xs font-bold uppercase tracking-wide text-ink-3">
          {m.accountUi.emailLabel}
        </label>
        <input
          id="unsubscribe-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full rounded-control border border-line-strong bg-card px-4 text-sm"
        />
        {error && <p role="alert" className="text-sm text-catch-ink">{error}</p>}
        {note && <p role="status" className="text-sm text-go">{note}</p>}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center rounded-control bg-ink px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? m.accountUi.removingBtn : m.accountUi.removeAddressBtn}
        </button>
      </form>
      <Link href="/privacy" className="mt-6 text-sm font-semibold text-ink underline">{m.accountUi.privacyNoticeLink}</Link>
    </main>
      <SiteFooter />
    </div>
  );
}
