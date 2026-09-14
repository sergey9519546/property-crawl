import type { Metadata } from "next";
import { DocumentReviewQueue } from "@/components/documents/document-review-queue";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = {
  title: "Document Review Queue | PerfectProperty",
  description:
    "Review pending documents captured by the build-data extraction pipeline before they are surfaced in the private workspace.",
};

export default function DocumentReviewPage() {
  return (
    <WorkspaceShell>
      <main>
        <DocumentReviewQueue />
      </main>
    </WorkspaceShell>
  );
}