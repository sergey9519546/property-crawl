"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, DatabaseZap, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import { sourceDisplayText } from "@/lib/source-display";

type Stage = { status: string; updatedAt?: string; reason?: string; error?: string; [key: string]: unknown };
type TransportErrorDetails = { code?: string; hostname?: string | null; retryable?: boolean };
type Job = { id: string; status: string; revision: number; trigger?: string; sourceIds?: string[]; createdAt: string; startedAt?: string | null; completedAt?: string | null; stages: Record<string, Stage>; errors?: { stage: string; message: string; at: string }[]; result?: { sourceResults?: { sourceId?: string; accepted?: number; rejected?: number; error?: string | null; errorDetails?: TransportErrorDetails; report?: { outcome?: string; complete?: boolean; truncated?: boolean } }[]; [key: string]: unknown } | null };

const stages = ["collection", "inventory", "observations", "hunts", "cases"];

function statusTone(status: string) {
  if (["completed", "verified_empty", "success"].includes(status)) return "bg-go-wash text-go";
  if (["failed", "blocked"].includes(status)) return "bg-catch-wash text-catch-ink";
  if (["partial", "truncated"].includes(status)) return "bg-catch-wash text-catch-ink";
  if (["running", "collecting"].includes(status)) return "bg-yours-wash text-yours";
  return "bg-paper text-ink-2";
}

function date(value?: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export function ActivityBoard() {
  const { messages: m } = useLocale();
  const session = useWorkspaceSession();
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [available, setAvailable] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");

  const refresh = React.useCallback(async (quiet = false) => {
    if (!session.authenticated) { setJobs([]); setError(""); return; }
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/source-network/jobs?limit=50", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (response.status === 401) {
        setJobs([]);
        await session.refresh();
        session.requestUnlock();
        throw new Error("Workspace locked. Unlock to refresh private activity.");
      }
      if (!response.ok) throw new Error(result.error || "Collection activity could not be loaded");
      setJobs(result.items || []); setAvailable(result.available !== false); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : quiet ? "Activity refresh failed. Showing stale results." : "Collection activity could not be loaded"); }
    finally { if (!quiet) setLoading(false); }
  }, [session.authenticated, session.refresh, session.requestUnlock]);

  React.useEffect(() => { if (!session.authenticated) { setJobs([]); setMessage(""); setError(""); return; } void refresh(); }, [refresh, session.authenticated]);
  React.useEffect(() => {
    if (!jobs.some((job) => ["queued", "running", "collecting"].includes(job.status))) return;
    const timer = window.setInterval(() => { if (typeof document === "undefined" || !document.hidden) void refresh(true); }, 2_500);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  async function runFullCycle() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/source-network/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-workspace-request": "1" },
        body: JSON.stringify({ scope: "all", idempotencyKey: `ui-${new Date().toISOString().slice(0, 16)}-${crypto.randomUUID()}` }),
      });
      const result = await response.json();
      if (response.status === 401) {
        setJobs([]);
        await session.refresh();
        session.requestUnlock();
        throw new Error("Workspace locked. Unlock to refresh private activity.");
      }
      if (!response.ok) throw new Error(result.error || "Collection cycle could not be started");
      setMessage(`Collection job ${result.job?.id || "accepted"} started. Inventory, observations, hunts, and cases will advance in order.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Collection cycle could not be started"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ink-2"><Activity size={17} /> {m.workspacePages.activityEyebrow}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{m.workspacePages.activityHeading}</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-ink-2">{m.workspacePages.activitySub}</p></div><div className="flex gap-2"><button type="button" disabled={loading || !session.authenticated} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-control border border-line bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{m.listingsUi.refreshBtn}</button><button type="button" disabled={busy || !session.authenticated || jobs.some((job) => ["queued", "running", "collecting"].includes(job.status))} onClick={() => void runFullCycle()} className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{m.workspacePages.activityRefreshEnabled}</button></div></div>
    <div className="mt-8"><PrivateWorkspaceGate allowMember title={m.workspacePages.activityUnlockTitle}>
      {!available && <p className="rounded-control bg-catch-wash p-4 text-sm text-catch-ink">Durable collection coordination is unavailable in this process. Restart both services with the workspace startup command.</p>}
      {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}{message && <p role="status" className="mt-4 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink">{message}</p>}
      <div className="mt-5 space-y-4">{jobs.map((job) => <article key={job.id} className="rounded-card border border-line bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-label font-bold uppercase tracking-wider ${statusTone(job.status)}`}>{job.status}</span><span className="text-xs text-ink-3">Revision {job.revision}</span></div><h2 className="mt-3 font-mono text-sm font-semibold">{job.id}</h2><p className="mt-1 text-xs text-ink-3">{job.sourceIds?.length ? sourceDisplayText(job.sourceIds.join(", ")) : "Complete source cycle"} · Started {date(job.startedAt || job.createdAt)}</p></div>{job.status === "completed" ? <CheckCircle2 className="text-go" /> : job.status === "failed" ? <XCircle className="text-catch-ink" /> : job.status === "partial" ? <AlertTriangle className="text-catch" /> : <Clock3 className="text-ink-3" />}</div>
          <div className="mt-5 grid gap-2 sm:grid-cols-5">{stages.map((name, index) => { const stage = job.stages?.[name] || { status: "queued" }; const finished = ["completed", "partial", "failed"].includes(job.status); const failedSources = job.result?.sourceResults?.some(source => Boolean(source.error) || source.report?.outcome === "failed"); const displayStatus = finished && stage.status === "queued" ? "not run" : name === "collection" && stage.status === "completed" && failedSources ? "finished with errors" : stage.status; return <div key={name} className="relative rounded-control bg-paper p-3"><p className="text-label font-bold uppercase tracking-wider text-ink-3">{index + 1}. {name}</p><p className={`mt-2 inline-block rounded px-2 py-1 text-label font-semibold ${statusTone(displayStatus === "finished with errors" ? "partial" : displayStatus)}`}>{displayStatus}</p>{stage.reason && <p className="mt-2 text-xs leading-4 text-ink-3">{sourceDisplayText(String(stage.reason).replaceAll("_", " "))}</p>}</div>; })}</div>
          {(job.result?.sourceResults || []).length > 0 && <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-xs font-semibold">Source outcomes</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{job.result?.sourceResults?.map((source, index) => { const outcome = source.error ? "failed" : source.report?.outcome || (source.accepted === 0 ? "empty" : "success"); return <div key={`${source.sourceId}-${index}`} className="rounded-control border border-line p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong>{sourceDisplayText(source.sourceId || "Source")}</strong><span className={`rounded px-2 py-1 text-label font-bold uppercase ${statusTone(outcome)}`}>{outcome}</span></div><p className="mt-2 text-ink-3">{source.accepted || 0} accepted · {source.rejected || 0} rejected{source.report?.truncated ? " · incomplete coverage" : ""}</p>{source.error && <div className="mt-2 space-y-1"><p className="text-catch-ink">{source.error === "fetch failed" ? "Connection failed. This run did not record the underlying network error." : sourceDisplayText(source.error)}</p>{source.errorDetails && <div className="rounded bg-catch-wash p-2 font-mono text-xs text-catch-ink"><p>Transport: {source.errorDetails.code || "unknown"}</p><p>Host: {source.errorDetails.hostname || "unknown"}</p><p>Retryable: {source.errorDetails.retryable === true ? "yes" : source.errorDetails.retryable === false ? "no" : "unknown"}</p></div>}</div>}</div>; })}</div></details>}
          {(job.errors || []).length > 0 && <div className="mt-4 rounded-control bg-catch-wash p-4 text-xs text-catch-ink">{job.errors?.map((item, index) => <p key={index}><strong>{item.stage}:</strong> {sourceDisplayText(item.message)}</p>)}</div>}
        </article>)}{loading && !jobs.length && <p className="flex items-center gap-2 rounded-card border border-line bg-card p-6 text-sm"><Loader2 size={17} className="animate-spin" />Loading durable jobs…</p>}{!loading && !jobs.length && <div className="rounded-card border border-dashed border-line bg-card p-8"><DatabaseZap className="text-ink" /><h2 className="mt-4 text-xl font-semibold">{m.workspacePages.activityEmptyTitle}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">Start a collection cycle here, or inspect individual source readiness. Positive matches use validated records from each safe source; incomplete coverage never implies a missing property was withdrawn.</p><Link href="/sources" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-ink underline hover:text-ink-2">Inspect source readiness <ArrowRight size={14} /></Link></div>}</div>
    </PrivateWorkspaceGate></div>
  </div>;
}
