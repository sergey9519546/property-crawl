import type { Metadata } from "next";
import { AlachuaSecondChance } from "@/components/research/alachua-second-chance";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.alachuaTitle || "Alachua Second Chance Review | PerfectProperty",
    description: t.alachuaDesc,
  };
}

export default function AlachuaSecondChancePage() { return <WorkspaceShell><main id="main-content" tabIndex={-1} className="outline-none"><AlachuaSecondChance /></main></WorkspaceShell>; }

