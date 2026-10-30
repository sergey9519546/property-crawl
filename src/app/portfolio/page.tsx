import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = {
  title: "Portfolio & Watchlist Dashboard | PerfectProperty",
  description:
    "Track saved foreclosure deals, monitor opening bid price drops, review upcoming auction dates, and analyze portfolio allocation.",
};

export default function PortfolioPage() {
  return (
    <WorkspaceShell>
      <main className="min-h-screen bg-paper">
        <PortfolioView />
      </main>
    </WorkspaceShell>
  );
}
