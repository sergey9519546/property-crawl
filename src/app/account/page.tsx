import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/account/account-panel";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { WorkspaceSessionProvider } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: locale === "en" ? "Account | PerfectProperty" : m.meta.accountTitle,
    robots: { index: false },
  };
}

export default async function AccountPage() {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16 outline-none">
          <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-3">{m.accountUi.accountEyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{m.accountUi.accountTitle}</h1>
          <div className="mt-6 rounded-card border border-line bg-card p-6 shadow-sm">
            <Suspense fallback={<p className="text-sm text-ink-3">{m.accountUi.loadingAccount}</p>}>
              <AccountPanel />
            </Suspense>
          </div>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
