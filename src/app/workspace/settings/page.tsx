import type { Metadata } from "next";
import { WorkspaceShell, PrivateWorkspaceGate } from "@/components/workspace/workspace-shell";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { WorkspaceSettingsView } from "./settings-view";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.workspaceSettingsTitle || "Workspace Settings | PerfectProperty",
    description: t.workspaceSettingsDesc,
  };
}

export default function WorkspaceSettingsPage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="outline-none">
        <DataModeBanner />
        <PrivateWorkspaceGate>
          <WorkspaceSettingsView />
        </PrivateWorkspaceGate>
      </main>
    </WorkspaceShell>
  );
}
