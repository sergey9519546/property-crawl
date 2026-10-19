import type { Metadata } from "next";
import { WorkspaceShell, PrivateWorkspaceGate } from "@/components/workspace/workspace-shell";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { WorkspaceSettingsView } from "./settings-view";

export const metadata: Metadata = {
  title: "Workspace Settings | PerfectProperty",
  description: "Operator configuration, active source tiers, and session boundaries.",
};

export default function WorkspaceSettingsPage() {
  return (
    <WorkspaceShell>
      <main>
        <DataModeBanner />
        <PrivateWorkspaceGate>
          <WorkspaceSettingsView />
        </PrivateWorkspaceGate>
      </main>
    </WorkspaceShell>
  );
}
