"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function CheckoutPanel() {
  const params = useSearchParams();
  const status = params.get("status");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!cancelled) setConfigured(body?.configured === true);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 503 || body?.configured === false) {
        setConfigured(false);
        setError("Checkout is not configured.");
        return;
      }
      if (!response.ok || typeof body?.url !== "string") {
        setError(typeof body?.error === "string" ? body.error : "Checkout did not return a URL.");
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("Checkout did not return a URL.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Billing</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Checkout</h1>
      <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600 shadow-sm">
        <p>Checkout does not unlock operator APIs and does not create an account in this beta.</p>
        {status === "returned" && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
            The browser came back from checkout. This beta did not record a paid account.
          </p>
        )}
        {status === "cancelled" && (
          <p>Checkout was cancelled. No account was created.</p>
        )}
        {configured === false && <p>Checkout is not configured. No charge was attempted.</p>}
        {configured === null && <p>Checking whether checkout is configured.</p>}
        {error && <p role="alert">{error}</p>}
        {configured === true && (
          <button
            type="button"
            onClick={startCheckout}
            disabled={pending}
            className="inline-flex h-12 items-center rounded-xl bg-[#0F172A] px-5 text-sm font-semibold text-white hover:bg-[#1E293B] disabled:opacity-60"
          >
            {pending ? "Opening Stripe…" : "Continue to Stripe"}
          </button>
        )}
      </div>
      <div className="mt-6">
        <Link href="/sign-in" className="text-sm font-semibold text-slate-900 underline">
          Operator sign-in
        </Link>
      </div>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-6 py-16 text-sm text-slate-600">Checkout</main>}>
      <CheckoutPanel />
    </Suspense>
  );
}
