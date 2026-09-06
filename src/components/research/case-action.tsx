"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Loader2 } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { cn } from "@/lib/utils";

export function CaseAction({ listingId, className, label = "Research" }: { listingId: string; className?: string; label?: string }) {
  const router = useRouter();
  const session = useWorkspaceSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function openCase() {
    if (!session.authenticated) { session.requestUnlock(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspace/cases", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, origin: { type: "manual" } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A research case could not be opened");
      const returnTo = `${window.location.pathname}${window.location.search}`;
      router.push(`/research/${encodeURIComponent(result.case.id)}?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "A research case could not be opened"); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0"><button type="button" disabled={busy} onClick={() => void openCase()} className={cn("inline-flex h-10 w-full items-center justify-center gap-1 rounded-xl border border-slate-900 bg-[#0F172A] px-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50", className)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpenCheck className="h-3.5 w-3.5" />}<span>{label}</span></button>{error && <p role="alert" className="mt-1 text-[10px] leading-4 text-red-700">{error}</p>}</div>;
}
