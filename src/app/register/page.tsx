import type { Metadata } from "next";
import Link from "next/link";
import { MemberSignInForm } from "@/components/account/account-panel";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { WorkspaceSessionProvider } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: locale === "en" ? "Create Account | PerfectProperty" : m.meta.registerTitle,
    description: locale === "en" ? "Create a PerfectProperty member account to save hunts, alerts, and property watchlists." : m.meta.registerDescription,
    robots: { index: false },
  };
}

export default async function RegisterPage() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16 outline-none">
          <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.signIn.accessEyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{m.signIn.createAccountTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-ink-3">{m.signIn.createAccountSubtitle}</p>
          <div className="mt-6 rounded-card border border-line bg-card p-6 shadow-sm"><MemberSignInForm /></div>
          <Link href="/listings" className="mt-6 text-sm font-semibold text-ink underline">{m.signIn.browseNoAccount}</Link>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
