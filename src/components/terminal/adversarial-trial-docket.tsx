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

export function AdversarialTrialDocket({
  listing,
  className = "",
  onJumpToWaterfall,
}: AdversarialTrialDocketProps) {
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
        throw new Error("Workspace session expired. Unlock it to transfer this case.");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initialize research case");

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
      setTransferError(err instanceof Error ? err.message : "Failed to transfer trial docket");
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
                  Adversarial Underwriting
                </span>
                <span className="text-xs text-ink-3">·</span>
                <span className="text-xs font-semibold text-ink-3">Property on Trial</span>
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
                The Trial: Prosecution vs. Defense Audit
              </h2>
              <p className="mt-0.5 text-xs text-ink-3 leading-relaxed">
                Adversarial deal-killer interrogation. The Prosecution attacks with 7 statutory title defects;
                the Defense responds with recording acts, cadastral proof, and walk-away math.
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
              <span>{busy ? "Transferring…" : "Transfer to Research Case"}</span>
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
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" aria-hidden="true" />
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold uppercase tracking-wide text-xs">
                  {docket.headline}
                </span>
                <span className="text-[11px] opacity-75">·</span>
                <span className="text-[11px] font-semibold opacity-90">
                  Recommended Workspace Action:{" "}
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
              Fatal Disqualifiers
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">{docket.fatalCount}</p>
          </div>
          <div className="rounded-control border border-amber-200 bg-amber-50/80 p-2.5">
            <span className="text-label font-bold uppercase tracking-wider text-amber-900">
              Caution Points
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">{docket.cautionCount}</p>
          </div>
          <div className="rounded-control border border-slate-200 bg-slate-100 p-2.5">
            <span className="text-label font-bold uppercase tracking-wider text-slate-800">
              Defenses Verified
            </span>
            <p className="mt-0.5 text-lg font-black text-ink">
              {docket.defenseCount} of {docket.defensePoints.length}
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
                The Prosecution
              </h3>
            </div>
            <span className="rounded bg-paper px-2 py-0.5 text-label font-bold uppercase text-ink-3 border border-line">
              7 Attack Vectors
            </span>
          </div>

          <p className="text-xs text-ink-3">
            Statutory attack vectors seeking to prove why tendering funds on this property will result in capital forfeiture or surviving debt.
          </p>

          <div className="space-y-2.5">
            {docket.prosecutionPoints.map((item) => (
              <ProsecutionCard key={item.id} item={item} />
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: THE DEFENSE */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <div className="rounded bg-slate-100 p-1 text-slate-800">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-bold tracking-tight text-ink">
                The Defense
              </h3>
            </div>
            <span className="rounded bg-paper px-2 py-0.5 text-label font-bold uppercase text-ink-3 border border-line">
              4 Value Shields
            </span>
          </div>

          <p className="text-xs text-ink-3">
            Legal recording acts, cadastral proof, and mathematical underwriting limits that shield the buyer&apos;s capital.
          </p>

          <div className="space-y-2.5">
            {docket.defensePoints.map((item) => (
              <DefenseCard key={item.id} item={item} />
            ))}
          </div>

          {/* Transfer & Cross-Navigation Box */}
          <div className="mt-4 rounded-control border border-line bg-paper/80 p-4 text-xs space-y-3 print:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">Direct Decision Bridge</span>
              <span className="text-[11px] text-ink-3">Syncs with /research</span>
            </div>
            <p className="text-ink-2 leading-relaxed">
              Transfer this trial docket to your Research Case to version the findings, apply statutory reason codes, and lock your decision packet.
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
                <span>Transfer Trial Docket to Research Case</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>

              {onJumpToWaterfall ? (
                <button
                  type="button"
                  onClick={onJumpToWaterfall}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-paper hover:text-ink"
                >
                  <Scale className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
                  <span>Simulate Lien Waterfall</span>
                </button>
              ) : (
                <a
                  href="#waterfall-simulator-section"
                  className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-paper hover:text-ink"
                >
                  <Scale className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
                  <span>Simulate Lien Waterfall</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProsecutionCard({ item }: { item: DocketCheckItem }) {
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
          ? "border-amber-200/80 bg-amber-50/50"
          : "border-line bg-card/70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {item.category}
          </span>
          <h4 className="font-bold text-ink truncate">{item.title}</h4>
        </div>

        <div>
          {isFatal ? (
            <span className="inline-flex items-center gap-1 rounded bg-catch/15 px-2 py-0.5 text-[10px] font-black uppercase text-catch-ink">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              Fatal Disqualifier
            </span>
          ) : isCaution ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Caution Flagged
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink-3 border border-line">
              <Search className="h-3 w-3" aria-hidden="true" />
              Pre-Auction Inquiry
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-ink leading-relaxed font-medium">{item.finding}</p>

      <div className="mt-2.5 pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>
          <strong className="text-ink-2">Statute:</strong> {item.statute}
        </span>
      </div>
    </article>
  );
}

function DefenseCard({ item }: { item: DocketCheckItem }) {
  const isVerified = item.status === "verified";

  return (
    <article
      data-testid={item.id}
      className={cn(
        "rounded-control border p-3.5 text-xs transition",
        isVerified ? "border-slate-300 bg-slate-50/70" : "border-line bg-card/70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {item.category}
          </span>
          <h4 className="font-bold text-ink truncate">{item.title}</h4>
        </div>

        <div>
          {isVerified ? (
            <span className="inline-flex items-center gap-1 rounded bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-800">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Defense Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink-3 border border-line">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Confirmation Pending
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-ink leading-relaxed font-medium">{item.finding}</p>

      <div className="mt-2.5 pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>
          <strong className="text-ink-2">Authority:</strong> {item.statute}
        </span>
      </div>
    </article>
  );
}
