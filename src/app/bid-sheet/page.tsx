import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { BidSheetView } from "@/components/workspace/bid-sheet-view";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: m.meta.bidSheetTitle,
    description: m.meta.bidSheetDescription,
    robots: { index: false, follow: false },
  };
}

export default function BidSheetPage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper outline-none">
        <DataModeBanner />
        <BidSheetView />
      </main>
    </WorkspaceShell>
  );
}
