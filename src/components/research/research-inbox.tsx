"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Download, Eye, FileWarning, Inbox, Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import type { ResearchCaseSummary } from "@/lib/workspace-types";
import { sourceDisplayText } from "@/lib/source-display";
import { createRequestGate } from "@/lib/latest-request";

type CaseList = { items: ResearchCaseSummary[]; total: number };
type ImportPreview = { previewHash: string; total: number; creatable: number; existing: number; accepted: { listingId: string; address?: string | null; existing: boolean }[]; rejected: { listingId: string; reason: string }[] };

const tabs = [
  { value: "inbox", label: "Inbox" },
  { value: "pursue", label: "Pursuing" },
  { value: "pass", label: "Passed" },
] as const;

function formatDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No published deadline";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function eventLabel(item: ResearchCaseSummary) {
  if (item.reconsiderationRequired) return "Second Look";
  const type = item.latestOrigin?.type;
  if (type === "material_change") return "Material change";
  if (type === "new_match" || type === "hunt_match") return "Hunt match";
  if (type === "evaluation_unknown") return "Evidence needed";
  if (type === "browser_import") return "Browser import";
  return "Manual research";
}

export function ResearchInbox() {
  const { messages: m } = useLocale();
  const session = useWorkspaceSession();
  const [state, setState] = React.useState<"inbox" | "pursue" | "pass">("inbox");
  const [data, setData] = React.useState<CaseList | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [importIds, setImportIds] = React.useState<string[]>([]);
  const [importing, setImporting] = React.useState(false);
  const [message, setMessage] = React.useState("");

  /**
   * Guards against out-of-order responses between the 8s poll and an
   * operator-triggered refresh. See src/lib/latest-request.ts — the rule is
   * extracted and unit-tested there because this project has no DOM test
   * runner, so a guard inlined in a .tsx can only be checked by reading it.
   */
  const requestGate = React.useRef(createRequestGate()).current;

  const refresh = React.useCallback(async (quiet = false) => {
    if (!session.memberTools) return;
    const token = requestGate.begin();
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/workspace/cases?state=${state}&limit=200`, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Research cases could not be loaded");
      // A response from a superseded request is discarded: it describes a
      // moment that has already been overtaken.
      if (!requestGate.isCurrent(token)) return;
      setData(result); setError(""); setLastUpdated(new Date());
    } catch (caught) {
      if (!requestGate.isCurrent(token)) return;
      // Reported even for a quiet poll. The alternative is leaving stale cases
      // on screen with no indication they are stale — the UI would be
      // confidently showing an out-of-date inbox as though it were current.
      setError(caught instanceof Error ? caught.message : "Research cases could not be loaded");
    }
    finally { if (requestGate.isCurrent(token) && !quiet) setLoading(false); }
  }, [session.memberTools, state]);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!session.memberTools) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh, session.memberTools]);

  function browserListingIds() {
    try {
      const saved = JSON.parse(localStorage.getItem("perfectproperty:saved-listings") || "[]");
      const records = JSON.parse(localStorage.getItem("perfectproperty:research-records:v1") || "[]");
      return [...new Set([
        ...(Array.isArray(saved) ? saved : []),
        ...(Array.isArray(records) ? records.map((record) => record?.id) : []),
      ].filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 200);
    } catch { return []; }
  }

  async function previewBrowserImport() {
    const listingIds = browserListingIds();
    if (!listingIds.length) { setMessage("No browser watchlist records are available to preview."); return; }
    setImporting(true); setMessage("");
    try {
      const response = await fetch("/api/workspace/import/preview", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingIds }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Browser import could not be previewed");
      setPreview(result.preview); setImportIds(listingIds);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Browser import could not be previewed"); }
    finally { setImporting(false); }
  }

  async function commitBrowserImport() {
    if (!preview) return;
    setImporting(true); setMessage("");
    try {
      const response = await fetch("/api/workspace/import/commit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingIds: importIds, previewHash: preview.previewHash }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Browser import could not be committed");
      setMessage(`${result.result.created.length} durable case${result.result.created.length === 1 ? "" : "s"} created; ${result.result.existing.length} already existed. Browser originals were retained.`);
      setPreview(null); setState("inbox"); await refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Browser import could not be committed"); }
    finally { setImporting(false); }
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ink"><Inbox size={17} /> {m.workspacePages.researchEyebrow}</p><h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{m.workspacePages.researchHeading}</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-ink-2">{m.workspacePages.researchSub}</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading || !session.memberTools} className="inline-flex items-center gap-2 rounded-control border border-line bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{m.listingsUi.refreshBtn}</button>
    </div>

    <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_330px]">
      <PrivateWorkspaceGate allowMember title={m.workspacePages.researchUnlockTitle}>
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-3">
            <div className="flex gap-1" role="tablist" aria-label="Case status">{tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={state === tab.value} onClick={() => setState(tab.value)} className={`rounded-control px-4 py-2 text-xs font-semibold ${state === tab.value ? "bg-ink text-white" : "text-ink-3 hover:bg-paper"}`}>{tab.value === "inbox" ? m.workspacePages.researchTabInbox : tab.value === "pursue" ? m.workspacePages.researchTabPursuing : m.workspacePages.researchTabPassed}</button>)}</div>
            <p className="text-xs text-ink-3">{m.workspacePages.researchAutoChecks}{lastUpdated ? ` · ${m.workspacePages.researchUpdated} ${lastUpdated.toLocaleTimeString()}` : ""}</p>
          </div>
          {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}
          {loading && !data ? <p className="mt-5 flex items-center gap-2 rounded-card border border-line bg-card p-6 text-sm"><Loader2 size={17} className="animate-spin" />{m.workspacePages.researchLoadingCases}</p> : <div className="mt-4 space-y-3">
            {data?.items.map((item) => <article key={item.id} className={`rounded-card border bg-card p-5 ${item.reconsiderationRequired ? "border-ink ring-2 ring-ink/10" : "border-line"}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-label font-bold uppercase tracking-wider ${item.reconsiderationRequired ? "bg-ink text-white" : item.latestOrigin?.type === "evaluation_unknown" ? "bg-catch-wash text-catch-ink" : "bg-paper text-ink-2"}`}>{eventLabel(item)}</span>{item.reconsiderationRequired && <span className="flex items-center gap-1 text-xs font-semibold text-yours"><RotateCcw size={13} />{m.workspacePages.researchDecisionUnchanged}</span>}</div><h2 className="mt-3 truncate text-xl font-semibold">{sourceDisplayText(item.address || item.listingId)}</h2><p className="mt-2 text-xs text-ink-3">{sourceDisplayText(item.sourceRef.sourceId)} · Record {sourceDisplayText(item.sourceRef.recordId)} · Revision {item.revision}</p></div>
                <Link href={`/research/${encodeURIComponent(item.id)}`} className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-2">{m.workspacePages.researchInvestigate} <ArrowRight size={14} /></Link>
              </div>
              <div className="mt-4 grid gap-3 border-t border-line pt-4 text-xs sm:grid-cols-4">
                <div><p className="text-ink-3">{m.workspacePages.researchPublishedDeadline}</p><p className="mt-1 flex items-center gap-1 font-semibold"><Clock3 size={13} />{formatDate(item.saleDate)}</p></div>
                <div><p className="text-ink-3">{m.workspacePages.researchOpeningAmount}</p><p className="mt-1 font-semibold">{typeof item.openingBid === "number" ? item.openingBid.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : m.workspacePages.researchUnknown}</p></div>
                <div><p className="text-ink-3">{m.workspacePages.researchTriggeringEvidence}</p><p className="mt-1 font-semibold">{item.latestOrigin?.changes && Object.keys(item.latestOrigin.changes).length ? Object.entries(item.latestOrigin.changes).map(([field, values]) => `${field}: ${String(values.previous ?? 'unknown')} → ${String(values.current ?? 'unknown')}`).join(" · ") : item.latestOrigin?.changedFields?.length ? item.latestOrigin.changedFields.join(", ") : eventLabel(item)}</p></div>
                <div><p className="text-ink-3">{m.workspacePages.researchCaseMaterial}</p><p className="mt-1 font-semibold">{item.originCount} · {item.evidenceCount}</p></div>
              </div>
            </article>)}
            {!data?.items.length && <div className="rounded-card border border-dashed border-line bg-card p-8"><CheckCircle2 className="text-ink" /><h2 className="mt-4 text-xl font-semibold">{m.workspacePages.researchNothingWaiting} {state}.</h2><p className="mt-2 text-sm leading-6 text-ink-2">{m.workspacePages.researchNothingWaitingHint}</p></div>}
          </div>}
        </section>
      </PrivateWorkspaceGate>
      <aside className="space-y-4">
        <section className="rounded-card bg-ink p-6 text-white"><Sparkles size={22} className="text-signature" /><h2 className="mt-4 text-xl font-semibold">{m.workspacePages.researchSecondLookTitle}</h2><p className="mt-2 text-sm leading-6 text-paper/80">{m.workspacePages.researchSecondLookBody}</p></section>
        {!(session.memberTools && !session.authenticated) && (
          <>
            <Link href="/research/alachua" className="flex items-center justify-between rounded-card border border-line bg-paper p-5 text-sm font-semibold text-ink hover:bg-card"><span className="flex items-center gap-2"><FileWarning size={17} />{m.workspacePages.researchAlachuaPilot}</span><ArrowRight size={15} /></Link>
            <section className="rounded-card border border-line bg-card p-5"><div className="flex items-center gap-2"><Download size={17} /><h2 className="font-semibold">{m.workspacePages.researchPreserveWorkTitle}</h2></div><p className="mt-2 text-xs leading-5 text-ink-2">{m.workspacePages.researchPreserveWorkBody}</p>{session.authenticated ? <button type="button" disabled={importing} onClick={() => void previewBrowserImport()} className="mt-4 w-full rounded-control border border-line px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{importing ? m.workspacePages.researchChecking : m.workspacePages.researchPreviewImport}</button> : <p className="mt-4 rounded-control bg-paper px-3 py-2 text-xs text-ink-3">{m.workspacePages.researchOperatorRequired}</p>}{preview && <div className="mt-4 rounded-control bg-paper p-4 text-xs leading-5"><p className="font-semibold">{preview.creatable} / {preview.existing} / {preview.rejected.length}</p><button type="button" disabled={importing} onClick={() => void commitBrowserImport()} className="mt-3 w-full rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-ink-2">{m.workspacePages.researchCommitImport}</button></div>}{message && <p role="status" className="mt-3 rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">{message}</p>}</section>
          </>
        )}
        <Link href="/hunts" className="flex items-center justify-between rounded-card border border-line bg-card p-5 text-sm font-semibold"><span className="flex items-center gap-2"><Eye size={17} />{m.workspacePages.researchCreateHunt}</span><ArrowRight size={15} /></Link>
        <Link href="/activity" className="flex items-center justify-between rounded-card border border-line bg-card p-5 text-sm font-semibold"><span className="flex items-center gap-2"><FileWarning size={17} />{m.workspacePages.researchInspectActivity}</span><ArrowRight size={15} /></Link>
      </aside>
    </div>
  </div>;
}
