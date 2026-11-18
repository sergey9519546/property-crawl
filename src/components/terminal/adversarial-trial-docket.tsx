"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Listing } from "@/data/listings";
import {
  evaluateAdversarialDocket,
  type AdversarialDocketResult,
  type DocketCheckItem,
} from "@/lib/adversarial-docket";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { readUnderwriteScenario } from "@/lib/underwrite-scenario";
import { useLocale } from "@/components/i18n/locale-provider";
import { interpolate } from "@/lib/i18n/translator";
import {
  Scale,
  Gavel,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Loader2,
  BookOpenCheck,
  FileText,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdversarialTrialDocketProps {
  listing: Listing;
  className?: string;
  onJumpToWaterfall?: () => void;
}

type UnderwritingDeepMessages = ReturnType<typeof useLocale>["messages"]["underwritingDeep"];

export function AdversarialTrialDocket({
  listing,
  className = "",
  onJumpToWaterfall,
}: AdversarialTrialDocketProps) {
  const { messages } = useLocale();
  const t = messages.underwritingDeep;

  const router = useRouter();
  const session = useWorkspaceSession();
  const [busy, setBusy] = useState(false);
  const [transferError, setTransferError] = useState("");

  const docket: AdversarialDocketResult = evaluateAdversarialDocket(listing);

  async function handleTransferToResearchCase() {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    setBusy(true);
    setTransferError("");
    try {
      const underwriteScenario = readUnderwriteScenario(listing.id);
      const res = await fetch("/api/workspace/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          origin: { type: "manual" },
          underwriteScenario: underwriteScenario || undefined,
        }),
      });

      if (res.status === 401) {
        session.requestUnlock();
        throw new Error(t.atdErrSessionExpired);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.atdErrInitCase);

      const caseId = data.case.id;

      // If the case is freshly initialized in inbox, populate the trial verdict & reason codes
      if (data.case.state === "inbox" && docket.recommendedDecision !== "inbox") {
        try {
          await fetch(`/api/workspace/cases/${encodeURIComponent(caseId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: data.case.revision,
              state: docket.recommendedDecision,
              reasonCodes: docket.recommendedReasonCodes,
              note: docket.docketSummaryNote,
            }),
          });
        } catch {
          // Non-fatal if patch fails; user will still land in research case
        }
      }

      const returnTo = `${window.location.pathname}${window.location.search}`;
      router.push(`/research/${encodeURIComponent(caseId)}?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : t.atdErrTransfer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="adversarial-trial-docket"
      className={cn(
        "rounded-card border border-line bg-card shadow-sm print:border-none print:shadow-none",
        className
      )}
      aria-labelledby="trial-docket-heading"
    >
      {/* Top Banner / Docket Header */}
      <div className="border-b border-line bg-paper/60 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-control bg-ink p-2 text-white shadow-xs">
              <Scale className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-card px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ink-2 border border-line">
                  {t.atdTag}
                </span>
                <span className="text-xs text-ink-3">·</span>
                <span className="text-xs font-semibold text-ink-3">{t.atdPropOnTrial}</span>
                <span className="text-xs text-ink-3">·</span>
                <span className="text-xs font-medium text-ink-3">
                  {listing.county ? `${listing.county}, ` : ""}
                  {(listing.state || "US").toUpperCase()}
                </span>
              </div>
              <h2
                id="trial-docket-heading"
                className="mt-1.5 text-xl font-bold tracking-tight text-ink sm:text-2xl"
              >
                {t.atdHeading}
              </h2>
              <p className="mt-0.5 text-xs text-ink-3 leading-relaxed">
                {t.atdSubtitle}
              </p>
            </div>
          </div>

          {/* Quick Action in Header */}
          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTransferToResearchCase()}
              className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-ink-2 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{busy ? t.atdTransferring : t.atdTransferBtn}</span>
            </button>
          </div>
        </div>

        {/* Verdict Callout Banner */}
        <div
          data-testid="trial-verdict-banner"
          className={cn(
            "mt-4 rounded-control border p-4 text-xs transition",
            docket.badgeClass
          )}
        >
          <div className="flex items-start gap-3">
            {docket.verdict === "fatal" ? (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" aria-hidden="true" />
            ) : docket.verdict === "conditional" ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch-ink" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink-2" aria-hidden="true" />
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold uppercase tracking-wide text-xs">
                  {docket.headline}
                </span>
                <span className="text-meta opacity-75">·</span>
                <span className="text-meta font-semibold opacity-90">
                  {t.atdRecAction}{" "}
                  <strong className="uppercase">{docket.recommendedDecision}</strong>
                </span>
              </div>
              <p className="leading-relaxed font-medium">{docket.verdictDescription}</p>
            </div>
          </div>
        </div>

        {/* Trial Scoreboard Tally */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs sm:gap-3">
          <div className="rounded-control border border-catch/30 bg-catch-wash/80 p-2.5">
            <span className="text-label font-bold uppercase tracking-wider text-catch-ink">
              {t.atdFatalDisq}
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">{docket.fatalCount}</p>
          </div>
          <div className="rounded-control border border-catch/25 bg-catch-wash/40 p-2.5">
            <span className="text-label font-bold uppercase tracking-wider text-catch-ink">
              {t.atdCautionPts}
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">{docket.cautionCount}</p>
          </div>
          <div className="rounded-control border border-line-strong bg-card p-2.5">
            <span className="text-label font-bold uppercase tracking-wider text-ink">
              {t.atdDefensesVer}
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">
              {interpolate(t.atdOfTotal, { count: docket.defenseCount, total: docket.defensePoints.length })}
            </p>
          </div>
        </div>
      </div>

      {/* Main Two-Column Split: The Prosecution vs. The Defense */}
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
        {/* LEFT COLUMN: THE PROSECUTION */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <div className="rounded bg-catch/10 p-1 text-catch-ink">
                <Gavel className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-bold tracking-tight text-ink">
                {t.atdProsecutionHeading}
              </h3>
            </div>
            <span className="rounded bg-paper px-2 py-0.5 text-label font-bold uppercase text-ink-3 border border-line">
              {t.atdAttackVectorsBadge}
            </span>
          </div>

          <p className="text-xs text-ink-3">
            {t.atdProsecutionSub}
          </p>

          <div className="space-y-2.5">
            {docket.prosecutionPoints.map((item) => (
              <ProsecutionCard key={item.id} item={item} t={t} />
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: THE DEFENSE */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <div className="rounded bg-paper p-1 text-ink border border-line">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-bold tracking-tight text-ink">
                {t.atdDefenseHeading}
              </h3>
            </div>
            <span className="rounded bg-paper px-2 py-0.5 text-label font-bold uppercase text-ink-3 border border-line">
              {t.atdDefenseShieldsBadge}
            </span>
          </div>

          <p className="text-xs text-ink-3">
            {t.atdDefenseSub}
          </p>

          <div className="space-y-2.5">
            {docket.defensePoints.map((item) => (
              <DefenseCard key={item.id} item={item} t={t} />
            ))}
          </div>

          {/* Transfer & Cross-Navigation Box */}
          <div className="mt-4 rounded-control border border-line bg-paper/80 p-4 text-xs space-y-3 print:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">{t.atdBridgeHeading}</span>
              <span className="text-meta text-ink-3">{t.atdBridgeSync}</span>
            </div>
            <p className="text-ink-2 leading-relaxed">
              {t.atdBridgeBody}
            </p>

            {transferError && (
              <p role="alert" className="text-xs font-semibold text-catch-ink">
                {transferError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTransferToResearchCase()}
                className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-ink-2 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{t.atdBridgeBtn}</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>

              {onJumpToWaterfall ? (
                <button
                  type="button"
                  onClick={onJumpToWaterfall}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-paper hover:text-ink"
                >
                  <Scale className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
                  <span>{t.atdSimWaterfall}</span>
                </button>
              ) : (
                <a
                  href="#waterfall-simulator-section"
                  className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-paper hover:text-ink"
                >
                  <Scale className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
                  <span>{t.atdSimWaterfall}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProsecutionCard({ item, t }: { item: DocketCheckItem; t: UnderwritingDeepMessages }) {
  const isFatal = item.isFatal && item.status === "disqualified";
  const isCaution = item.status === "caution";

  return (
    <article
      data-testid={item.id}
      className={cn(
        "rounded-control border p-3.5 text-xs transition",
        isFatal
          ? "border-catch/40 bg-catch-wash/60"
          : isCaution
          ? "border-catch/25 bg-catch-wash/30"
          : "border-line bg-card/70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="rounded bg-line px-1.5 py-0.5 text-label font-bold uppercase tracking-wider text-ink-3">
            {item.category}
          </span>
          <h4 className="font-bold text-ink truncate">{item.title}</h4>
        </div>

        <div>
          {isFatal ? (
            <span className="inline-flex items-center gap-1 rounded bg-catch/15 px-2 py-0.5 text-label font-black uppercase text-catch-ink">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              {t.atdFatalBadge}
            </span>
          ) : isCaution ? (
            <span className="inline-flex items-center gap-1 rounded border border-catch/20 bg-catch-wash px-2 py-0.5 text-label font-bold uppercase text-catch-ink">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {t.atdCautionBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-paper px-2 py-0.5 text-label font-semibold text-ink-3 border border-line">
              <Search className="h-3 w-3" aria-hidden="true" />
              {t.atdPreAuctionBadge}
            </span>
          )}
        </div>
      </div>

      <p className={`mt-1.5 leading-relaxed ${isFatal || isCaution ? "font-medium text-ink" : "text-ink-2"}`}>{item.finding}</p>
      {isFatal || isCaution ? (
        <div className="mt-2 pt-2 border-t border-line/60 text-meta text-ink-3">
          <strong className="text-ink-2">{t.atdStatuteLabel}</strong> {item.statute}
        </div>
      ) : (
        <details className="mt-1.5 text-meta text-ink-3">
          <summary className="cursor-pointer font-semibold hover:text-ink">{t.atdStatuteRefSummary}</summary>
          <p className="mt-1">{item.statute}</p>
        </details>
      )}
    </article>
  );
}

function DefenseCard({ item, t }: { item: DocketCheckItem; t: UnderwritingDeepMessages }) {
  const isVerified = item.status === "verified";

  return (
    <article
      data-testid={item.id}
      className={cn(
        "rounded-control border p-3.5 text-xs transition",
        isVerified ? "border-line-strong bg-card" : "border-line bg-paper/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="rounded bg-line px-1.5 py-0.5 text-label font-bold uppercase tracking-wider text-ink-3">
            {item.category}
          </span>
          <h4 className="font-bold text-ink truncate">{item.title}</h4>
        </div>

        <div>
          {isVerified ? (
            <span className="inline-flex items-center gap-1 rounded border border-line-strong bg-paper px-2 py-0.5 text-label font-bold uppercase text-ink">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {t.atdDefenseVerifiedBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-paper px-2 py-0.5 text-label font-semibold text-ink-3 border border-line">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {t.atdDefensePendingBadge}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-ink leading-relaxed font-medium">{item.finding}</p>

      <div className="mt-2.5 pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-3">
        <span>
          <strong className="text-ink-2">{t.atdAuthorityLabel}</strong> {item.statute}
        </span>
      </div>
    </article>
  );
}
