import type { Metadata } from "next";
import { ResearchInbox } from "@/components/research/research-inbox";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = {
  title: "Research Inbox | PerfectProperty",
  description: "Review material property changes, evidence gaps, and Second Look reconsideration events.",
};

export default function ResearchPage() {
  return <WorkspaceShell><main><ResearchInbox /></main></WorkspaceShell>;
}

