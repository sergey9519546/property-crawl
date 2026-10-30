import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/account/account-panel";

export const metadata: Metadata = { title: "Account | PerfectProperty", robots: { index: false } };

export default function AccountPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Account</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Your account</h1>
      <div className="mt-6 rounded-2xl border border-line bg-card p-6 shadow-sm">
        <Suspense fallback={<p className="text-sm text-ink-3">Loading your account…</p>}>
          <AccountPanel />
        </Suspense>
      </div>
    </main>
  );
}
