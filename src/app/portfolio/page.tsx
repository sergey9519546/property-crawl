import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: locale === "en" ? "Portfolio & Watchlist Dashboard | PerfectProperty" : m.meta.portfolioTitle,
    description:
      locale === "en"
        ? "Track saved foreclosure deals, monitor opening bid price drops, review upcoming auction dates, and analyze portfolio allocation."
        : m.meta.portfolioDescription,
    robots: { index: false, follow: false },
  };
}

export default function PortfolioPage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper outline-none">
        <PortfolioView />
      </main>
    </WorkspaceShell>
  );
}
