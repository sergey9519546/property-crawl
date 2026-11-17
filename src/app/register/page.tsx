import Link from "next/link";
import { MemberSignInForm } from "@/components/account/account-panel";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { WorkspaceSessionProvider } from "@/components/workspace/workspace-shell";

export default function RegisterPage() {
  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16 outline-none">
          <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">Access</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Create an account</h1>
          <p className="mt-3 text-sm leading-6 text-ink-3">Enter your email. The sign-in link creates your account; there is no password. Subscribe from your account page to unlock hunts, alerts, and the portfolio.</p>
          <div className="mt-6 rounded-card border border-line bg-card p-6 shadow-sm"><MemberSignInForm /></div>
          <Link href="/listings" className="mt-6 text-sm font-semibold text-ink underline">Browse listings without an account</Link>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
