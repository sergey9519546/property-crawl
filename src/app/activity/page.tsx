import type { Metadata } from "next";
import { ActivityBoard } from "@/components/activity/activity-board";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = { title: "Collection Activity | PerfectProperty", description: "Inspect durable acquisition, inventory, observation, hunt, and research-case handoffs." };

export default function ActivityPage() { return <WorkspaceShell><main><ActivityBoard /></main></WorkspaceShell>; }

