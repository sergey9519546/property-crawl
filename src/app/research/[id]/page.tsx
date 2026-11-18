import type { Metadata } from "next";
import { ResearchCase } from "@/components/research/research-case";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.researchCaseTitle || "Property Research Case | PerfectProperty",
    description: t.researchCaseDesc,
  };
}

export default async function ResearchCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceShell><main id="main-content" tabIndex={-1} className="outline-none"><ResearchCase caseId={id} /></main></WorkspaceShell>;
}

