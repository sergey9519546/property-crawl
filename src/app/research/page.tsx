import type { Metadata } from "next";
import { ResearchInbox } from "@/components/research/research-inbox";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = {
  title: "Property Title Risk & Lien Triage | PerfectProperty",
  description: "Review material property changes, evidence gaps, and Second Look reconsideration events.",
  alternates: {
    canonical: "/research",
  },
  openGraph: {
    title: "Property Title Risk & Lien Triage | PerfectProperty",
    description: "Review material property changes, evidence gaps, and Second Look reconsideration events.",
    url: "/research",
    siteName: "PerfectProperty",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Property Title Risk & Lien Triage | PerfectProperty",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Property Title Risk & Lien Triage | PerfectProperty",
    description: "Review material property changes, evidence gaps, and Second Look reconsideration events.",
    images: ["/og-image.png"],
  },
};

export default function ResearchPage() {
  return <WorkspaceShell><main><ResearchInbox /></main></WorkspaceShell>;
}

