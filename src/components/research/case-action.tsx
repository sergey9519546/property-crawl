"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Loader2 } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { cn } from "@/lib/utils";
import { readUnderwriteScenario } from "@/lib/underwrite-scenario";
import { useLocale } from "@/components/i18n/locale-provider";

export function CaseAction({ listingId, className, label }: { listingId: string; className?: string; label?: string }) {
  const { messages: m } = useLocale();
  const buttonLabel = label ?? m.listingsUi.researchBtn;
  const router = useRouter();
  const session = useWorkspaceSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function openCase() {
    if (!session.authenticated) { session.requestUnlock(); return; }
    setBusy(true); setError("");
    try {
      const underwriteScenario = readUnderwriteScenario(listingId);
      const response = await fetch("/api/workspace/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          origin: { type: "manual" },
          underwriteScenario: underwriteScenario || undefined,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        session.requestUnlock();
        throw new Error("Your workspace session expired. Unlock it, then try again.");
      }
      if (!response.ok) throw new Error(result.error || "A research case could not be opened");
      const returnTo = `${window.location.pathname}${window.location.search}`;
      router.push(`/research/${encodeURIComponent(result.case.id)}?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "A research case could not be opened"); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0"><button type="button" disabled={busy} aria-busy={busy} onClick={() => void openCase()} className={cn("inline-flex h-10 w-full items-center justify-center gap-1 rounded-control border border-ink bg-ink px-2 text-xs font-bold text-white transition hover:bg-ink-2 disabled:opacity-50", className)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />}<span aria-live="polite">{busy ? m.listingsUi.openingBtnBusy : buttonLabel}</span></button>{error && <p role="alert" className="mt-1 text-xs leading-4 text-catch-ink">{error}</p>}</div>;
}
