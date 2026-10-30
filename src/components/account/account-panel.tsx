"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2, LogOut, Mail } from "lucide-react";

type Account = {
  email: string;
  entitled: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  hasBilling: boolean;
};
type Price = { unitAmount: number | null; currency: string | null; interval: string | null } | null;

const button = "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-50";

async function json(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function priceLabel(price: Price) {
  if (!price || price.unitAmount === null || !price.currency) return null;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.unitAmount / 100);
  return price.interval ? `${amount} / ${price.interval}` : amount;
}

export function MemberSignInForm() {
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await json(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The sign-in link could not be sent");
      setNotice(typeof body.message === "string" ? body.message : "Check your inbox for a sign-in link.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in link could not be sent");
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="member-email" className="block text-sm font-semibold text-ink">Email</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="member-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} placeholder="you@example.com" className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-card px-3 text-sm outline-none focus:border-ink" />
        <button disabled={pending} className={`${button} bg-ink text-white hover:bg-ink-2`}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Email me a sign-in link
        </button>
      </div>
      {notice && <p role="status" className="rounded-xl bg-go-wash p-3 text-sm text-go">{notice}</p>}
      {error && <p role="alert" className="rounded-xl bg-catch-wash p-3 text-sm text-catch-ink">{error}</p>}
    </form>
  );
}

export function VerifySignIn() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  async function confirm() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/account/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await json(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "This sign-in link is invalid or expired");
      router.replace("/account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This sign-in link is invalid or expired");
      setPending(false);
    }
  }

  if (!token) return <p className="text-sm text-ink-3">This link has no sign-in token. <Link href="/sign-in" className="font-semibold underline">Request a new link</Link>.</p>;
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => void confirm()} disabled={pending} className={`${button} bg-ink text-white hover:bg-ink-2`}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm sign-in
      </button>
      {error && <p role="alert" className="rounded-xl bg-catch-wash p-3 text-sm text-catch-ink">{error} <Link href="/sign-in" className="font-semibold underline">Request a new link</Link>.</p>}
    </div>
  );
}

export function AccountPanel() {
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const [account, setAccount] = React.useState<Account | null | undefined>(undefined);
  const [price, setPrice] = React.useState<Price>(null);
  const [checkoutReady, setCheckoutReady] = React.useState<boolean | null>(null);
  const [pending, setPending] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    const body = await json(await fetch("/api/account", { cache: "no-store", credentials: "same-origin" }));
    const next = (body.account as Account | null) ?? null;
    setAccount(next);
    return next;
  }, []);

  React.useEffect(() => {
    void load().catch(() => setAccount(null));
    void fetch("/api/checkout", { cache: "no-store" }).then(json).then((body) => {
      setCheckoutReady(body.configured === true);
      setPrice((body.price as Price) ?? null);
    }).catch(() => setCheckoutReady(false));
  }, [load]);

  // Stripe sends the browser back before its webhook may have landed; poll briefly.
  React.useEffect(() => {
    if (checkout !== "success" || !account || account.entitled) return;
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const next = await load().catch(() => null);
      if (next?.entitled || tries >= 15) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [checkout, account, load]);

  async function post(path: string, label: string, method = "POST") {
    setPending(label); setError("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin" });
      const body = await json(response);
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The request failed");
      return body;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed");
      return null;
    } finally { setPending(""); }
  }

  if (account === undefined) return <p className="text-sm text-ink-3">Loading your account…</p>;
  if (!account) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-ink-3">Sign in with your email. We send a one-time link; there is no password.</p>
        <MemberSignInForm />
      </div>
    );
  }

  const label = priceLabel(price);
  const periodEnd = account.currentPeriodEnd ? new Date(account.currentPeriodEnd).toLocaleDateString() : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Signed in as <strong className="text-ink">{account.email}</strong></p>
        <button type="button" disabled={Boolean(pending)} onClick={async () => { if (await post("/api/account", "logout", "DELETE")) setAccount(null); }} className={`${button} border border-line-strong text-ink-2 hover:bg-paper`}><LogOut className="h-4 w-4" />Sign out</button>
      </div>

      {account.entitled ? (
        <div data-testid="subscription-active" className="rounded-2xl border border-go/30 bg-go-wash p-5 text-sm text-go">
          <p className="font-semibold">Subscription active{periodEnd ? ` · renews or ends ${periodEnd}` : ""}</p>
          <p className="mt-1">Hunts with email alerts, saved searches, your watchlist, and the portfolio are unlocked for this account.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/hunts" className={`${button} bg-ink text-white hover:bg-ink-2`}>Open hunts</Link>
            <Link href="/portfolio" className={`${button} border border-line-strong bg-card text-ink`}>Portfolio</Link>
          </div>
        </div>
      ) : (
        <div data-testid="subscription-inactive" className="rounded-2xl border border-line bg-card p-5 text-sm text-ink-2 shadow-sm">
          <p className="font-semibold text-ink">{checkout === "success" ? "Payment received. Activating your subscription…" : account.subscriptionStatus ? `Subscription ${account.subscriptionStatus.replace(/_/g, " ")}` : "No subscription yet"}</p>
          <p className="mt-1">A subscription unlocks hunts with email alerts, saved searches, your account watchlist, and the portfolio.{label ? ` ${label}.` : ""}</p>
          {checkout === "cancelled" && <p className="mt-2 text-ink-3">Checkout was cancelled. Nothing was charged.</p>}
          {checkoutReady === false && <p className="mt-3 rounded-xl bg-catch-wash p-3 text-catch-ink">Checkout is not configured on this deployment.</p>}
          {checkoutReady && (
            <button type="button" disabled={Boolean(pending)} onClick={async () => { const body = await post("/api/checkout", "checkout"); if (typeof body?.url === "string") window.location.assign(body.url); }} className={`${button} mt-4 bg-ink text-white hover:bg-ink-2`}>
              {pending === "checkout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Subscribe{label ? ` · ${label}` : ""}
            </button>
          )}
        </div>
      )}

      {account.hasBilling && (
        <button type="button" disabled={Boolean(pending)} onClick={async () => { const body = await post("/api/account/portal", "portal"); if (typeof body?.url === "string") window.location.assign(body.url); }} className={`${button} border border-line-strong text-ink-2 hover:bg-paper`}>
          <CreditCard className="h-4 w-4" />Manage billing
        </button>
      )}
      {error && <p role="alert" className="rounded-xl bg-catch-wash p-3 text-sm text-catch-ink">{error}</p>}
    </div>
  );
}
