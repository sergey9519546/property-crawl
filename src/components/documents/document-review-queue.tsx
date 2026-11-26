"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Columns2, FileWarning, Inbox, LayoutList, Loader2, MessageSquareWarning, RefreshCw, ShieldQuestion, ThumbsDown } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { ReviewSplitPane } from "@/components/workspace/review-split-pane";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/config";
import { formatLocaleDate, formatLocaleNumber, interpolate } from "@/lib/i18n/translator";

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
  reason?: string | null;
  reasons?: string[] | null;
  rawText?: string | null;
  extractedFields?: {
    caseNumber?: string;
    defendant?: string;
    plaintiff?: string;
    openingBid?: number;
    judgmentAmount?: number;
    saleDate?: string;
    apn?: string;
    confidenceScore?: number;
    evidenceSpans?: any;
  } | null;
};

type QueueSummary = {
  total: number;
  byStatus: Record<"pending" | "approved" | "rejected" | "needs_more", number>;
  reviews: ReviewEntry[];
};

const STATUS_TONE: Record<Review["status"], string> = {
  pending: "bg-paper text-ink-2",
  approved: "bg-go-wash text-go",
  rejected: "bg-catch-wash text-catch-ink",
  needs_more: "bg-catch-wash text-catch-ink",
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

function formatDate(locale: Locale, value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return formatLocaleDate(locale, value, { dateStyle: "medium", timeStyle: "short" });
}

export function DocumentReviewQueue() {
  const { locale, messages } = useLocale();
  const t = messages.reviewB2;
  const statusLabel: Record<Review["status"], string> = React.useMemo(
    () => ({
      pending: t.statusPending,
      approved: t.statusApproved,
      rejected: t.statusRejected,
      needs_more: t.statusNeedsMore,
    }),
    [t],
  );

  const session = useWorkspaceSession();
  const [data, setData] = React.useState<QueueSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [notesDraft, setNotesDraft] = React.useState<Record<string, string>>({});
  const [reviewerDraft, setReviewerDraft] = React.useState("");
  const [viewMode, setViewMode] = React.useState<"cards" | "split">("cards");

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
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await session.refresh();
        session.requestUnlock();
        throw new Error(t.errLockedRefresh);
      }
      if (!response.ok) throw new Error(result.error || t.errLoad);
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
      setError(caught instanceof Error ? caught.message : t.errLoad);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session, t.errLoad, t.errLockedRefresh]);

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
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh(true);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [refresh, session.authenticated]);

  const applyDecision = React.useCallback(async (
    entry: ReviewEntry,
    status: Review["status"],
    noteOverride?: string,
    updatedFields?: Record<string, unknown>,
  ): Promise<boolean> => {
    const rawNote = noteOverride !== undefined ? noteOverride : (notesDraft[entry.id] ?? "");
    const fieldSummary = updatedFields
      ? Object.entries(updatedFields)
          .filter(([k, v]) => k !== "confidenceScore" && v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")
      : "";
    const notes = [rawNote.trim(), fieldSummary ? `[fields: ${fieldSummary}]` : ""]
      .filter(Boolean)
      .join(" ")
      .trim();
    const reviewer = reviewerDraft.trim();
    if (TERMINAL_STATUSES.includes(status) && !reviewer) {
      setStatusMessage("");
      setError(t.errReviewerRequired);
      return false;
    }
    if ((status === "rejected" || status === "needs_more") && !rawNote.trim()) {
      setStatusMessage("");
      setError(t.errNoteRequired);
      return false;
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
          updatedFields: updatedFields || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await session.refresh();
        session.requestUnlock();
        throw new Error(t.errLockedRecord);
      }
      if (!response.ok) throw new Error(result.error || t.errRecord);
      setStatusMessage(interpolate(t.msgRecorded, {
        status: statusLabel[status],
        index: entry.documentIndex ?? 0,
        listingId: entry.listingId,
      }));
      setNotesDraft((prev) => {
        if (!prev[entry.id]) return prev;
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      await refresh(true);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errRecord);
      return false;
    } finally {
      setPendingId(null);
    }
  }, [notesDraft, refresh, reviewerDraft, session, statusLabel, t.errLockedRecord, t.errNoteRequired, t.errRecord, t.errReviewerRequired, t.msgRecorded]);

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ink-2">
            <FileWarning size={17} /> {t.kicker}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t.heading || "Document review queue"}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-ink-2">
            {t.subtitle}{" "}
            {t.durabilityNote}
          </p>
        </div>
        <button
          type="button"
          disabled={loading || !session.authenticated}
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-control border border-line bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          {t.refreshBtn}
        </button>
      </div>

      <PrivateWorkspaceGate title={t.gateTitle || "Unlock the document review queue"}>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {(["pending", "approved", "rejected", "needs_more"] as const).map((key) => (
            <div key={key} className="rounded-card border border-line bg-card p-4 shadow-sm">
              <p className={`inline-block rounded-full px-2 py-1 text-label font-bold uppercase tracking-wider ${STATUS_TONE[key]}`}>
                {statusLabel[key]}
              </p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{formatLocaleNumber(locale, data?.byStatus[key] ?? 0)}</p>
              <p className="mt-1 text-xs text-ink-3">{t.unitDocuments}</p>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}
        {statusMessage && <p role="status" className="mt-4 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink">{statusMessage}</p>}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-card p-5 shadow-sm">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <ShieldQuestion size={16} className="text-ink-3" />
            <label htmlFor="document-review-reviewer" className="text-xs font-semibold text-ink-2">{t.reviewerLabel || "Reviewer identifier"}</label>
            <input
              id="document-review-reviewer"
              type="text"
              value={reviewerDraft}
              onChange={(event) => setReviewerDraft(event.target.value)}
              placeholder={t.reviewerPlaceholder}
              className="min-w-[12rem] flex-1 rounded-control border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div className="inline-flex rounded-control border border-line bg-paper p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`inline-flex items-center gap-1.5 rounded-control px-3.5 py-1.5 text-xs font-semibold transition ${viewMode === "cards" ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              <LayoutList size={14} />
              {t.cardViewBtn}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`inline-flex items-center gap-1.5 rounded-control px-3.5 py-1.5 text-xs font-semibold transition ${viewMode === "split" ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              <Columns2 size={14} />
              {t.splitViewBtn}
            </button>
          </div>
        </div>

        {viewMode === "split" && data && data.reviews.length > 0 ? (
          <div className="mt-6">
            <ReviewSplitPane
              items={data.reviews.map((entry) => ({
                id: entry.id,
                listingId: entry.listingId,
                sourceUrl: entry.documentUrl || undefined,
                rawText: entry.rawText || `Source Document: ${entry.listingId} (Doc #${entry.documentIndex ?? 0})\nDocument URL: ${entry.documentUrl || "None attached"}\nExtraction timestamp: ${entry.review.extractedAt || "Observed via crawler"}\nCurrent review status: ${entry.review.status}\nPrior status: ${entry.review.priorStatus || "None"}`,
                extractedFields: {
                  caseNumber: entry.extractedFields?.caseNumber || entry.listingId,
                  defendant: entry.extractedFields?.defendant,
                  plaintiff: entry.extractedFields?.plaintiff,
                  openingBid: entry.extractedFields?.openingBid,
                  judgmentAmount: entry.extractedFields?.judgmentAmount,
                  saleDate: entry.extractedFields?.saleDate,
                  apn: entry.extractedFields?.apn,
                  confidenceScore: entry.extractedFields?.confidenceScore ?? (entry.review.status === "approved" ? 1.0 : undefined),
                  evidenceSpans: entry.extractedFields?.evidenceSpans,
                },
                reviewStatus: entry.review.status === "needs_more" ? "pending" : (entry.review.status as any),
              }))}
              onApprove={async (id, updatedFields, note) => {
                const entry = data.reviews.find((r) => r.id === id);
                if (!entry) return false;
                return applyDecision(entry, "approved", note, updatedFields);
              }}
              onReject={async (id, note, updatedFields) => {
                const entry = data.reviews.find((r) => r.id === id);
                if (!entry) return false;
                return applyDecision(entry, "rejected", note ?? notesDraft[entry.id] ?? "", updatedFields);
              }}
            />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {loading && !data && (
              <p className="flex items-center gap-2 rounded-card border border-line bg-card p-6 text-sm">
                <Loader2 size={17} className="animate-spin" />
                {t.loadingPending}
              </p>
            )}
            {!loading && data && data.reviews.length === 0 && (
              <div className="rounded-card border border-dashed border-line bg-card p-8">
                <Inbox className="text-ink" />
                <h2 className="mt-4 text-xl font-semibold">{t.emptyTitle}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
                  {t.emptyBody}
                </p>
              </div>
            )}
          {data?.reviews.map((entry) => {
            const href = safeHref(entry.documentUrl ?? null);
            const note = notesDraft[entry.id] ?? "";
            const disabled = pendingId === entry.id || !session.authenticated;
            return (
              <article key={entry.id} className="rounded-card border border-line bg-card p-5 shadow-sm" data-testid="document-review-row">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-label font-bold uppercase tracking-wider ${STATUS_TONE[entry.review.status]}`}>
                        {statusLabel[entry.review.status]}
                      </span>
                      <span className="text-xs text-ink-3">
                        {interpolate(t.docRevMeta, {
                          index: entry.documentIndex != null ? `#${entry.documentIndex}` : t.docUnindexed,
                          revision: entry.review.revision,
                        })}
                      </span>
                      {entry.review.priorStatus && (
                        <span className="text-xs text-ink-3">
                          {interpolate(t.previouslyStatus, {
                            status: statusLabel[entry.review.priorStatus as Review["status"]] ?? entry.review.priorStatus,
                          })}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 font-mono text-sm font-semibold">
                      <Link href={`/listings/${encodeURIComponent(entry.listingId)}`} className="hover:underline">
                        {entry.listingId}
                      </Link>
                    </h2>
                    {href && (
                      <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full break-all text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                        {href}
                      </a>
                    )}
                    <p className="mt-1 text-xs text-ink-3">
                      {interpolate(t.timelineMeta, {
                        extracted: formatDate(locale, entry.review.extractedAt),
                        reviewedPart: entry.review.reviewedAt
                          ? interpolate(t.lastDecisionPart, { date: formatDate(locale, entry.review.reviewedAt) })
                          : "",
                        reviewerPart: entry.review.reviewer ? ` · ${entry.review.reviewer}` : "",
                      })}
                    </p>
                    {entry.reason && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md border border-catch/30 bg-catch-wash px-2 py-0.5 text-label font-semibold text-catch-ink">
                          {entry.reason}
                        </span>
                        {entry.reasons?.map((r) => (
                          <span key={r} className="rounded-md bg-paper px-1.5 py-0.5 text-label text-ink-2">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                    {entry.review.notes && (
                      <p className="mt-3 rounded-control bg-paper px-3 py-2 text-xs leading-5 text-ink-2">
                        <strong>{t.latestNotePrefix}</strong> {entry.review.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="text-xs font-semibold text-ink-2">{t.noteLabel}</span>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(event) => setNotesDraft((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                      placeholder={t.notePlaceholder}
                      className="mt-2 w-full rounded-control border border-line-strong px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap items-end justify-end gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "approved")}
                      className="inline-flex items-center gap-2 rounded-control bg-go px-3 py-2 text-sm font-semibold text-white hover:bg-go/90 disabled:opacity-50"
                      data-action="approve"
                    >
                      <Check size={14} /> {t.approveBtn}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "needs_more")}
                      className="inline-flex items-center gap-2 rounded-control border border-catch/40 bg-catch-wash px-3 py-2 text-sm font-semibold text-catch-ink hover:bg-catch-wash/80 disabled:opacity-50"
                      data-action="needs_more"
                    >
                      <MessageSquareWarning size={14} /> {t.needsMoreBtn}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyDecision(entry, "rejected")}
                      className="inline-flex items-center gap-2 rounded-control bg-catch-ink px-3 py-2 text-sm font-semibold text-white hover:bg-catch disabled:opacity-50"
                      data-action="reject"
                    >
                      <ThumbsDown size={14} /> {t.rejectBtn}
                    </button>
                  </div>
                </div>

                {pendingId === entry.id && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                    <Loader2 size={14} className="animate-spin" />
                    {t.savingReview}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

        {data && (data.byStatus.approved + data.byStatus.rejected + data.byStatus.needs_more) > 0 && data.byStatus.pending === 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink">
            <Check size={16} className="text-go" />
            {t.allReviewedBanner}
          </div>
        )}
      </PrivateWorkspaceGate>
    </div>
  );
}
