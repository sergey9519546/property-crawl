import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { BidSheetView } from "@/components/workspace/bid-sheet-view";

export const metadata: Metadata = {
  title: "Courthouse Bid Sheet & Check Ladder | PerfectProperty",
  description:
    "Pre-wire escrow schedule, cashier's check denomination ladder, and walk-away MAO sheet for courthouse auction execution.",
  robots: { index: false, follow: false },
};

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
