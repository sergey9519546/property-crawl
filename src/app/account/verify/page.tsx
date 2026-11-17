import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifySignIn } from "@/components/account/account-panel";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { WorkspaceSessionProvider } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = { title: "Confirm sign-in | PerfectProperty", robots: { index: false } };

export default function VerifyPage() {
  return (
    <WorkspaceSessionProvider>
      <div className="min-h-screen bg-paper text-ink">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16 outline-none">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Confirm sign-in</h1>
          <p className="mt-3 text-sm text-ink-3">Confirm to finish signing in on this browser.</p>
          <div className="mt-6">
            <Suspense fallback={null}><VerifySignIn /></Suspense>
          </div>
        </main>
        <SiteFooter />
      </div>
    </WorkspaceSessionProvider>
  );
}
