import Link from "next/link";
import { MemberSignInForm } from "@/components/account/account-panel";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Access</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Create an account</h1>
      <p className="mt-3 text-sm leading-6 text-ink-3">Enter your email. The sign-in link creates your account; there is no password. Subscribe from your account page to unlock hunts, alerts, and the portfolio.</p>
      <div className="mt-6 rounded-2xl border border-line bg-card p-6 shadow-sm"><MemberSignInForm /></div>
      <Link href="/listings" className="mt-6 text-sm font-semibold text-ink underline">Browse listings without an account</Link>
    </main>
  );
}
