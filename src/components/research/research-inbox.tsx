"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Download, Eye, FileWarning, Inbox, Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import type { ResearchCaseSummary } from "@/lib/workspace-types";
import { sourceDisplayText } from "@/lib/source-display";

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

  const refresh = React.useCallback(async (quiet = false) => {
    if (!session.authenticated) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/workspace/cases?state=${state}&limit=200`, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Research cases could not be loaded");
      setData(result); setError(""); setLastUpdated(new Date());
    } catch (caught) { if (!quiet) setError(caught instanceof Error ? caught.message : "Research cases could not be loaded"); }
    finally { if (!quiet) setLoading(false); }
  }, [session.authenticated, state]);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!session.authenticated) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh, session.authenticated]);

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
      <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-900"><Inbox size={17} /> Research inbox</p><h1 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">What changed, and what deserves another look?</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-[#6B7280]">New hunt matches, material source changes, evidence gaps, and passed cases that now meet your reconsideration rules arrive here automatically.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading || !session.authenticated} className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Refresh</button>
    </div>

    <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_330px]">
      <PrivateWorkspaceGate title="Unlock the research inbox">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-3">
            <div className="flex gap-1" role="tablist" aria-label="Case status">{tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={state === tab.value} onClick={() => setState(tab.value)} className={`rounded-lg px-4 py-2 text-xs font-semibold ${state === tab.value ? "bg-[#0F172A] text-white" : "text-[#6B7280] hover:bg-[#F3F4F6]"}`}>{tab.label}</button>)}</div>
            <p className="text-[11px] text-[#9CA3AF]">Auto-checks every 8 seconds{lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString()}` : ""}</p>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{error}</p>}
          {loading && !data ? <p className="mt-5 flex items-center gap-2 rounded-2xl bg-white p-6 text-sm"><Loader2 size={17} className="animate-spin" />Loading durable cases…</p> : <div className="mt-4 space-y-3">
            {data?.items.map((item) => <article key={item.id} className={`rounded-2xl border bg-white p-5 ${item.reconsiderationRequired ? "border-slate-900 shadow-[0_0_0_3px_rgba(15,23,42,0.10)]" : "border-[#E5E7EB]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${item.reconsiderationRequired ? "bg-[#0F172A] text-white" : item.latestOrigin?.type === "evaluation_unknown" ? "bg-amber-100 text-amber-900" : "bg-[#F3F4F6] text-[#466057]"}`}>{eventLabel(item)}</span>{item.reconsiderationRequired && <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><RotateCcw size={13} />Your decision is unchanged until review</span>}</div><h2 className="mt-3 truncate text-xl font-semibold">{sourceDisplayText(item.address || item.listingId)}</h2><p className="mt-2 text-xs text-[#6B7280]">{sourceDisplayText(item.sourceRef.sourceId)} · Record {sourceDisplayText(item.sourceRef.recordId)} · Revision {item.revision}</p></div>
                <Link href={`/research/${encodeURIComponent(item.id)}`} className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white">Investigate <ArrowRight size={14} /></Link>
              </div>
              <div className="mt-4 grid gap-3 border-t border-[#F3F4F6] pt-4 text-xs sm:grid-cols-4">
                <div><p className="text-[#9CA3AF]">Published deadline</p><p className="mt-1 flex items-center gap-1 font-semibold"><Clock3 size={13} />{formatDate(item.saleDate)}</p></div>
                <div><p className="text-[#9CA3AF]">Opening amount</p><p className="mt-1 font-semibold">{typeof item.openingBid === "number" ? item.openingBid.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Unknown"}</p></div>
                <div><p className="text-[#9CA3AF]">Triggering evidence</p><p className="mt-1 font-semibold">{item.latestOrigin?.changes && Object.keys(item.latestOrigin.changes).length ? Object.entries(item.latestOrigin.changes).map(([field, values]) => `${field}: ${String(values.previous ?? 'unknown')} → ${String(values.current ?? 'unknown')}`).join(" · ") : item.latestOrigin?.changedFields?.length ? item.latestOrigin.changedFields.join(", ") : eventLabel(item)}</p></div>
                <div><p className="text-[#9CA3AF]">Case material</p><p className="mt-1 font-semibold">{item.originCount} origin{item.originCount === 1 ? "" : "s"} · {item.evidenceCount} attachment{item.evidenceCount === 1 ? "" : "s"}</p></div>
              </div>
            </article>)}
            {!data?.items.length && <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-white p-8"><CheckCircle2 className="text-slate-900" /><h2 className="mt-4 text-xl font-semibold">Nothing waiting in {state}.</h2><p className="mt-2 text-sm leading-6 text-[#6B7280]">Run an enabled hunt after a complete collection or add a source-observed listing to research. Failed and partial collections do not generate disappearance events.</p></div>}
          </div>}
        </section>
      </PrivateWorkspaceGate>
      <aside className="space-y-4">
        <section className="rounded-2xl bg-[#0F172A] p-6 text-white"><Sparkles size={22} className="text-emerald-400" /><h2 className="mt-4 text-xl font-semibold">Second Look</h2><p className="mt-2 text-sm leading-6 text-slate-200/80">Pass with a reason and a supported return condition. A changed bid, sale date, status, building area, or newly linked evidence can bring the case back without rewriting your decision.</p></section>
        <Link href="/research/alachua" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-950 hover:bg-slate-100"><span className="flex items-center gap-2"><FileWarning size={17} />Alachua Second Chance pilot</span><ArrowRight size={15} /></Link>
        <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5"><div className="flex items-center gap-2"><Download size={17} /><h2 className="font-semibold">Preserve browser work</h2></div><p className="mt-2 text-xs leading-5 text-[#6B7280]">Preview local watchlist IDs against live publisher records. Demo and unresolved IDs stay rejected for review; originals remain in browser storage.</p><button type="button" disabled={!session.authenticated || importing} onClick={() => void previewBrowserImport()} className="mt-4 w-full rounded-lg border border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{importing ? "Checking…" : "Preview durable import"}</button>{preview && <div className="mt-4 rounded-xl bg-[#F1F5F9] p-4 text-xs leading-5"><p className="font-semibold">{preview.creatable} new · {preview.existing} existing · {preview.rejected.length} need review</p><p className="mt-1 text-[#6B7280]">Only {preview.accepted.length} validated live records can become cases.</p><button type="button" disabled={importing} onClick={() => void commitBrowserImport()} className="mt-3 w-full rounded-lg bg-[#0F172A] px-3 py-2 text-xs font-semibold text-white">Commit reviewed import</button></div>}{message && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{message}</p>}</section>
        <Link href="/hunts" className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white p-5 text-sm font-semibold"><span className="flex items-center gap-2"><Eye size={17} />Create a hunt</span><ArrowRight size={15} /></Link>
        <Link href="/activity" className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white p-5 text-sm font-semibold"><span className="flex items-center gap-2"><FileWarning size={17} />Inspect collection outcomes</span><ArrowRight size={15} /></Link>
      </aside>
    </div>
  </div>;
}
