"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, DatabaseZap, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { sourceDisplayText } from "@/lib/source-display";

type Stage = { status: string; updatedAt?: string; reason?: string; error?: string; [key: string]: unknown };
type Job = { id: string; status: string; revision: number; trigger?: string; sourceIds?: string[]; createdAt: string; startedAt?: string | null; completedAt?: string | null; stages: Record<string, Stage>; errors?: { stage: string; message: string; at: string }[]; result?: { sourceResults?: { sourceId?: string; accepted?: number; rejected?: number; error?: string | null; report?: { outcome?: string; complete?: boolean; truncated?: boolean } }[]; [key: string]: unknown } | null };

const stages = ["collection", "inventory", "observations", "hunts", "cases"];

function statusTone(status: string) {
  if (["completed", "verified_empty", "success"].includes(status)) return "bg-emerald-100 text-emerald-900";
  if (["failed", "blocked"].includes(status)) return "bg-red-100 text-red-900";
  if (["partial", "truncated"].includes(status)) return "bg-amber-100 text-amber-950";
  if (["running", "collecting"].includes(status)) return "bg-slate-200 text-slate-900";
  return "bg-stone-100 text-stone-700";
}

function date(value?: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export function ActivityBoard() {
  const session = useWorkspaceSession();
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [available, setAvailable] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");

  const refresh = React.useCallback(async (quiet = false) => {
    if (!session.authenticated) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/source-network/jobs?limit=50", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Collection activity could not be loaded");
      setJobs(result.items || []); setAvailable(result.available !== false); setError("");
    } catch (caught) { if (!quiet) setError(caught instanceof Error ? caught.message : "Collection activity could not be loaded"); }
    finally { if (!quiet) setLoading(false); }
  }, [session.authenticated]);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!jobs.some((job) => ["queued", "running", "collecting"].includes(job.status))) return;
    const timer = window.setInterval(() => void refresh(true), 2_500);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  async function runFullCycle() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/source-network/run", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "all", idempotencyKey: `ui-${new Date().toISOString().slice(0, 16)}-${crypto.randomUUID()}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Collection cycle could not be started");
      setMessage(`Collection job ${result.job?.id || "accepted"} started. Inventory, observations, hunts, and cases will advance in order.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Collection cycle could not be started"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700"><Activity size={17} /> Activity</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Every handoff, with its outcome.</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-[#6B7280]">Collection commits inventory before recording observations, then evaluates enabled hunts and updates research cases only when the cycle is complete enough to support those conclusions.</p></div><div className="flex gap-2"><button type="button" disabled={loading || !session.authenticated} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Refresh</button><button type="button" disabled={busy || !session.authenticated || jobs.some((job) => ["queued", "running", "collecting"].includes(job.status))} onClick={() => void runFullCycle()} className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}Run complete cycle</button></div></div>
    <div className="mt-8"><PrivateWorkspaceGate title="Unlock collection activity">
      {!available && <p className="rounded-xl bg-amber-100 p-4 text-sm text-amber-950">Durable collection coordination is unavailable in this process. Restart both services with the workspace startup command.</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{error}</p>}{message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">{message}</p>}
      <div className="mt-5 space-y-4">{jobs.map((job) => <article key={job.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusTone(job.status)}`}>{job.status}</span><span className="text-[11px] text-[#9CA3AF]">Revision {job.revision}</span></div><h2 className="mt-3 font-mono text-sm font-semibold">{job.id}</h2><p className="mt-1 text-xs text-[#9CA3AF]">{job.sourceIds?.length ? sourceDisplayText(job.sourceIds.join(", ")) : "Complete source cycle"} · Started {date(job.startedAt || job.createdAt)}</p></div>{job.status === "completed" ? <CheckCircle2 className="text-emerald-600" /> : job.status === "failed" ? <XCircle className="text-red-700" /> : job.status === "partial" ? <AlertTriangle className="text-amber-700" /> : <Clock3 className="text-slate-600" />}</div>
          <div className="mt-5 grid gap-2 sm:grid-cols-5">{stages.map((name, index) => { const stage = job.stages?.[name] || { status: "queued" }; return <div key={name} className="relative rounded-xl bg-[#F1F5F9] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{index + 1}. {name}</p><p className={`mt-2 inline-block rounded px-2 py-1 text-[10px] font-semibold ${statusTone(stage.status)}`}>{stage.status}</p>{stage.reason && <p className="mt-2 text-[10px] leading-4 text-[#6B7280]">{sourceDisplayText(String(stage.reason).replaceAll("_", " "))}</p>}</div>; })}</div>
          {(job.result?.sourceResults || []).length > 0 && <details className="mt-4 border-t border-[#F3F4F6] pt-4"><summary className="cursor-pointer text-xs font-semibold">Source outcomes</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{job.result?.sourceResults?.map((source, index) => { const outcome = source.error ? "failed" : source.report?.outcome || (source.accepted === 0 ? "empty" : "success"); return <div key={`${source.sourceId}-${index}`} className="rounded-lg border border-[#E5E7EB] p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong>{sourceDisplayText(source.sourceId || "Source")}</strong><span className={`rounded px-2 py-1 text-[9px] font-bold uppercase ${statusTone(outcome)}`}>{outcome}</span></div><p className="mt-2 text-[#6B7280]">{source.accepted || 0} accepted · {source.rejected || 0} rejected{source.report?.truncated ? " · incomplete coverage" : ""}</p>{source.error && <p className="mt-2 text-red-800">{sourceDisplayText(source.error)}</p>}</div>; })}</div></details>}
          {(job.errors || []).length > 0 && <div className="mt-4 rounded-xl bg-red-50 p-4 text-xs text-red-950">{job.errors?.map((item, index) => <p key={index}><strong>{item.stage}:</strong> {sourceDisplayText(item.message)}</p>)}</div>}
        </article>)}{loading && !jobs.length && <p className="flex items-center gap-2 rounded-2xl bg-white p-6 text-sm"><Loader2 size={17} className="animate-spin" />Loading durable jobs…</p>}{!loading && !jobs.length && <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-white p-8"><DatabaseZap className="text-slate-900" /><h2 className="mt-4 text-xl font-semibold">No coordinated runs yet.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">Start a complete cycle here. Per-source retries remain available in Sources, but only a clean complete cycle can safely run every enabled hunt.</p><Link href="/sources" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline">Inspect source readiness <ArrowRight size={14} /></Link></div>}</div>
    </PrivateWorkspaceGate></div>
  </div>;
}
