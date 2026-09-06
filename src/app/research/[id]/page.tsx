import type { Metadata } from "next";
import { ResearchCase } from "@/components/research/research-case";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = { title: "Property Research Case | PerfectProperty", description: "Compare evidence, record a decision, and reconstruct the case revision." };

export default async function ResearchCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceShell><main><ResearchCase caseId={id} /></main></WorkspaceShell>;
}

