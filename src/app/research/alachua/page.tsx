import type { Metadata } from "next";
import { AlachuaSecondChance } from "@/components/research/alachua-second-chance";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = { title: "Alachua Second Chance Review | PerfectProperty", description: "Review imported Alachua County public-purchase cases, parcel evidence, status history, and unresolved costs." };

export default function AlachuaSecondChancePage() { return <WorkspaceShell><main><AlachuaSecondChance /></main></WorkspaceShell>; }

