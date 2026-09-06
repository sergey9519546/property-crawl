import React from "react";
import { Suspense } from "react";
import { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { DiscoveryWorkbench } from "@/components/listings/discovery-workbench";
import { DiscoveryExportAction } from "@/components/listings/discovery-export-action";

export const metadata: Metadata = {
  title: "Distressed Property Evidence Feed | PerfectProperty",
  description: "Research source-observed and clearly labeled demonstration foreclosure, sheriff-sale, and government-property records. Unknown auction and title facts remain explicit.",
  openGraph: {
    title: "Distressed Property Evidence Feed | PerfectProperty",
    description: "A source-aware property research feed with exact-record links, evidence gaps, and explicit model provenance.",
  }
};

export default function ListingsDirectoryPage() {
  return (
    <WorkspaceShell>
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-[#F5F6F7] text-[#111827]">
      <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm text-slate-500">Loading discovery…</div>}>
        <DiscoveryWorkbench />
        <DiscoveryExportAction />
      </Suspense>
    </main>
    </WorkspaceShell>
  );
}
