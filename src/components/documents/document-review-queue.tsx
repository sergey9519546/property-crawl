"use client";

import * as React from "react";
import { Check, FileWarning, Inbox, Loader2, MessageSquareWarning, RefreshCw, ShieldQuestion, ThumbsDown } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";

type Review = {
  status: "pending" | "approved" | "rejected" | "needs_more";
  notes: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  revision: number;
  priorStatus: string | null;
  extractedAt?: string | null;
};

type ReviewEntry = {
  id: string;
  listingId: string;
  documentIndex?: number | null;
  documentUrl?: string | null;
  review: Review;
};

type QueueSummary = {
  total: number;
  byStatus: Record<"pending" | "approved" | "rejected" | "needs_more", number>;
  reviews: ReviewEntry[];
};

const STATUS_LABEL: Record<Review["status"], string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  needs_more: "Needs more",
};

const STATUS_TONE: Record<Review["status"], string> = {
  pending: "bg-slate-100 text-slate-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-red-100 text-red-900",
  needs_more: "bg-amber-100 text-amber-900",
};

const TERMINAL_STATUSES: Array<Review["status"]> = ["approved", "rejected", "needs_more"];

function safeHref(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatDate(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DocumentReviewQueue() {
  const session = useWorkspaceSession();
  const [data, setData] = React.useState<QueueSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [notesDraft, setNotesDraft] = React.useState<Record<string, string>>({});
  const [reviewerDraft, setReviewerDraft] = React.useState("");

  const refresh = React.useCallback(async (quiet = false) => {
    if (!session.authenticated) {
      setData(null);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/document-review?status=pending", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = await response.json();
      if (response.status === 401) {
        await session.refresh();
        session.requestUnlock();
        throw new Error("Workspace locked. Unlock to refresh the document review queue.");
      }
      if (!response.ok) throw new Error(result.error || "Document reviews could not be loaded");
      setData({
        total: Number(result.total) || 0,
        byStatus: {
          pending: Number(result.byStatus?.pending) || 0,
          approved: Number(result.byStatus?.approved) || 0,
          rejected: Number(result.byStatus?.rejected) || 0,
          needs_more: Number(result.byStatus?.needs_more) || 0,
        },
        reviews: Array.isArray(result.reviews) ? result.reviews : [],
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document reviews could not be loaded");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session]);

  React.useEffect(() => {
    if (!session.authenticated) {
      setData(null);
      setError("");
      setStatusMessage("");
      return;
    }
    void refresh();
  }, [refresh, session.authenticated]);

  React.useEffect(() => {
    if (!session.authenticated) return;
    if (document.visibilityState !== "visible") return;
    const timer = window.setInterval(() => { void refresh(true); }, 12_000);
    return () => window.clearInterval(timer);
  }, [refresh, session.authenticated]);

  const applyDecision = React.useCallback(async (entry: ReviewEntry, status: Review["status"]) => {
    const notes = (notesDraft[entry.id] ?? "").trim();
    const reviewer = reviewerDraft.trim();
    if (TERMINAL_STATUSES.includes(status) && !reviewer) {
      setStatusMessage("");
      setError("Reviewer identifier is required for terminal actions.");
      return;
    }
    if ((status === "rejected" || status === "needs_more") && !notes) {
      setStatusMessage("");
      setError("A note is required when rejecting a document or marking it for follow-up.");
      return;
    }
    setPendingId(entry.id);
    setError("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/document-review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: entry.listingId,
          documentIndex: entry.documentIndex ?? null,
          documentUrl: entry.documentUrl ?? null,
          status,
          reviewer: reviewer || undefined,
          notes: notes || undefined,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        await session.refresh();
        session.requestUnlock();
        throw new Error("Workspace locked. Unlock to record reviews.");
      }
      if (!response.ok) throw new Error(result.error || "Review could not be recorded");
      setStatusMessage(`Recorded ${STATUS_LABEL[status]} on document ${entry.documentIndex ?? 0} for ${entry.listingId}.`);
      setNotesDraft((prev) => {
        if (!prev[entry.id]) return prev;
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      await refresh(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review could not be recorded");
    } finally {
      setPendingId(null);
    }
  }, [notesDraft, refresh, reviewerDraft, session]);

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-600">
            <FileWarning size={17} /> Document review
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Document review queue</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#6B7280]">
            Publisher documents from the listing evidence pipeline, plus any
            decisions you record. Approve, reject, or request more evidence
            before an item is treated as reviewed. Decisions write through to
            PostgreSQL <code className="text-[12px]">document_reviews</code> when{" "}
            <code className="text-[12px]">DATABASE_URL</code> is set, otherwise a
            host-local file under <code className="text-[12px]">.cache/</code>.
            File mode survives API restarts but is lost on container recreate
            unless a volume is attached. Check{" "}
            <code className="text-[12px]">GET /api/health</code>{" "}
            <code className="text-[12px]">documentReviewStore</code>.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || !session.authenticated}
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Refresh queue
        </button>
      </div>

      <PrivateWorkspaceGate title="Unlock the document review queue">
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {(["pending", "approved", "rejected", "needs_more"] as const).map((key) => (
            <div key={key} className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <p className={`inline-block rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[key]}`}>
                {STATUS_LABEL[key]}
              </p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{data?.byStatus[key] ?? 0}</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">documents</p>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{error}</p>}
        {statusMessage && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">{statusMessage}</p>}

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <ShieldQuestion size={16} className="text-slate-500" />
          <label htmlFor="document-review-reviewer" className="text-xs font-semibold text-[#6B7280]">Reviewer identifier</label>
          <input
            id="document-review-reviewer"
            type="text"
            value={reviewerDraft}
            onChange={(event) => setReviewerDraft(event.target.value)}
            placeholder="operator-7"
            className="min-w-[12rem] flex-1 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
          />
          <p className="text-xs leading-5 text-[#9CA3AF]">Required for every terminal action. Notes are required when rejecting or requesting follow-up.</p>
        </div>

        <div className="mt-6 space-y-4">
          {loading && !data && (
            <p className="flex items-center gap-2 rounded-2xl bg-white p-6 text-sm">
              <Loader2 size={17} className="animate-spin" />
              Loading pending reviews…
            </p>
          )}
          {!loading && data && data.reviews.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-white p-8">
              <Inbox className="text-slate-900" />
              <h2 className="mt-4 text-xl font-semibold">No pending documents.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
                The build-data extraction pipeline has nothing waiting for review. Refresh the page after the next cycle to inspect new captures.
              </p>
            </div>
          )}
          {data?.reviews.map((entry) => {
            const href = safeHref(entry.documentUrl ?? null);
            const note = notesDraft[entry.id] ?? "";
            const disabled = pendingId === entry.id || !session.authenticated;
            return (
              <article key={entry.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm" data-testid="document-review-row">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[entry.review.status]}`}>
                        {STATUS_LABEL[entry.review.status]}
                      </span>
                      <span className="text-[11px] text-[#9CA3AF]">
                        Document {entry.documentIndex != null ? `#${entry.documentIndex}` : "(unindexed)"} · Revision {entry.review.revision}
                      </span>
                      {entry.review.priorStatus && (
                        <span className="text-[11px] text-[#9CA3AF]">Previously {STATUS_LABEL[entry.review.priorStatus as Review["status"]] ?? entry.review.priorStatus}</span>
                      )}
                    </div>
                    <h2 className="mt-3 font-mono text-sm font-semibold">{entry.listingId}</h2>
                    {href && (
                      <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full break-all text-xs text-[#6B7280] underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950">
                        {href}
                      </a>
                    )}
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      Extracted {formatDate(entry.review.extractedAt)}{entry.review.reviewedAt ? ` · Last decision ${formatDate(entry.review.reviewedAt)}` : ""}{entry.review.reviewer ? ` · ${entry.review.reviewer}` : ""}
                    </p>
                    {entry.review.notes && (
                      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-[#374151]">
                        <strong>Latest note:</strong> {entry.review.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="text-xs font-semibold text-[#6B7280]">Reviewer note (required for reject / needs more)</span>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(event) => setNotesDraft((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                      placeholder="What did you observe? Why is this approval / rejection the right call?"
                      className="mt-2 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap items-end justify-end gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "approved")}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      data-action="approve"
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "needs_more")}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      data-action="needs_more"
                    >
                      <MessageSquareWarning size={14} /> Needs more
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "rejected")}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      data-action="reject"
                    >
                      <ThumbsDown size={14} /> Reject
                    </button>
                  </div>
                </div>

                {pendingId === entry.id && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-[#6B7280]">
                    <Loader2 size={14} className="animate-spin" />
                    Saving review…
                  </p>
                )}
              </article>
            );
          })}
        </div>

        {data && data.reviews.length > 0 && data.byStatus.pending === 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">
            <Check size={16} />
            All extracted documents have been reviewed.
          </div>
        )}
      </PrivateWorkspaceGate>
    </div>
  );
}