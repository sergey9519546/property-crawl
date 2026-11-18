import type { Metadata } from "next";
import { ActivityBoard } from "@/components/activity/activity-board";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: locale === "en" ? "Collection Activity | PerfectProperty" : m.meta.activityTitle,
    description:
      locale === "en"
        ? "Inspect durable acquisition, inventory, observation, hunt, and research-case handoffs."
        : m.meta.activityDescription,
  };
}

export default function ActivityPage() { return <WorkspaceShell><main id="main-content" tabIndex={-1} className="outline-none"><ActivityBoard /></main></WorkspaceShell>; }
