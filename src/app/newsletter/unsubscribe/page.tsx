"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function UnsubscribePage() {
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
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Removal failed");
      setNote(typeof body?.message === "string" ? body.message : "If that address was on the newsletter list, it has been removed.");
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Removal failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Newsletter</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Remove a newsletter address</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        This removes an exact email from the newsletter list. Contact messages are not changed. Member accounts are not deleted here; ask through the contact form.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label htmlFor="unsubscribe-email" className="block text-xs font-bold uppercase tracking-wide text-slate-500">
          Email
        </label>
        <input
          id="unsubscribe-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full rounded-xl border border-slate-300 px-4 text-sm"
        />
        {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
        {note && <p role="status" className="text-sm text-slate-700">{note}</p>}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center rounded-xl bg-[#0F172A] px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Removing…" : "Remove address"}
        </button>
      </form>
      <Link href="/privacy" className="mt-6 text-sm font-semibold text-slate-900 underline">Privacy notice</Link>
    </main>
  );
}
