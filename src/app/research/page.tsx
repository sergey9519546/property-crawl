import type { Metadata } from "next";
import { ResearchInbox } from "@/components/research/research-inbox";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  const title = locale === "en" ? "Property Title Risk & Lien Triage | PerfectProperty" : m.meta.researchTitle;
  const description = locale === "en"
    ? "Review material property changes, evidence gaps, and Second Look reconsideration events."
    : m.meta.researchDescription;
  return {
    title,
    description,
    alternates: {
      canonical: "/research",
    },
    openGraph: {
      title,
      description,
      url: "/research",
      siteName: "PerfectProperty",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default function ResearchPage() {
  return <WorkspaceShell><main id="main-content" tabIndex={-1} className="outline-none"><ResearchInbox /></main></WorkspaceShell>;
}
