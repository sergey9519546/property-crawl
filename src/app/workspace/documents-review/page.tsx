import type { Metadata } from "next";
import { DocumentReviewQueue } from "@/components/documents/document-review-queue";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.docReviewTitle || "Document Review Queue | PerfectProperty",
    description: t.docReviewDesc,
  };
}

export default function DocumentReviewPage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="outline-none">
        <DataModeBanner />
        <DocumentReviewQueue />
      </main>
    </WorkspaceShell>
  );
}