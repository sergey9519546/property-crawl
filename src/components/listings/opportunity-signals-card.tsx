'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { priorityBand } from '@/lib/triage-bands';

export type OpportunitySignal = {
  key: string;
  label: string;
  status: 'supported' | 'unknown' | 'contradicted';
  evidenceClass: string;
  sourceUrl?: string | null;
  observedAt?: string | null;
  reason: string;
  nextAction: string;
};

export type ComponentScore = {
  label: string;
  weight: number;
  maxPoints: number;
  earnedPoints: number;
  status: string;
};

export type OpportunitySignalsData = {
  triagePriority: number;
  signals: OpportunitySignal[];
  weights?: Record<string, number>;
  componentScores?: Record<string, ComponentScore>;
  summary?: { supported: number; unknown: number; contradicted: number };
  disclaimer?: string;
  /** True when the observation history could not be read, so negative findings are unverified. */
  historyUnavailable?: boolean;
};

interface Props {
  listingId: string;
  initialData?: OpportunitySignalsData | null;
  compact?: boolean;
}

// Descriptions live with the UI; the numeric weights are single-sourced from
// the backend evaluation payload (data.weights) so they can never drift.
const WEIGHT_DETAILS: Record<string, { label: string; desc: string }> = {
  bidToValueRatio: { label: 'Bid-to-Value Ratio', desc: 'Compares confirmed opening bid to estimated valuation midpoint.' },
  saleDateKnown: { label: 'Published Sale Date', desc: 'Validates that a future active auction date is publisher-confirmed.' },
  bidReduction: { label: 'Bid Reduction', desc: 'Detects same-record opening bid drops in source observation history.' },
  areaDiscrepancy: { label: 'Building Area Discrepancy', desc: 'Flags discrepancies between publisher sqft and official cadastral records.' },
  returnedToMarket: { label: 'Returned to Market', desc: 'Detects relisting notices, auction restarts, or back-on-market tags.' },
  dataCompleteness: { label: 'Data Completeness', desc: 'Measures how many of the three canonical research artifacts — title facts, area corroboration, and a valuation band — resolved to supported evidence.' },
};

function weightPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function OpportunitySignalsCard({ listingId, initialData = null, compact = false }: Props) {
  const [data, setData] = useState<OpportunitySignalsData | null>(initialData);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState<boolean>(false);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function fetchSignals() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/property-signals?listingId=${encodeURIComponent(listingId)}`);
        if (!res.ok) {
          throw new Error(`Failed to load signals (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to evaluate signals');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchSignals();
    return () => {
      cancelled = true;
    };
  }, [listingId, initialData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 bg-paper rounded-2xl border border-line text-xs text-ink-3 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-ink-2" />
        <span>Checking research signals…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-catch-wash rounded-2xl border border-catch/30 text-xs text-catch-ink flex items-center justify-between">
        <span>{error || 'Signals currently unavailable for this listing'}</span>
      </div>
    );
  }

  const priority = data.triagePriority ?? 0;
  const band = priorityBand(priority);
  const unscored = band === 'unscored';
  const isHigh = band === 'high';
  const isMed = band === 'moderate';

const supportedCount = data.summary?.supported ?? data.signals.filter((s) => s.status === 'supported').length;
  const contradictedCount = data.summary?.contradicted ?? data.signals.filter((s) => s.status === 'contradicted').length;
  // Say the unresolved ones out loud. The score is a headline number resting on
  // whichever signals actually resolved, and "1 supported · 0 conflicting" alone
  // reads like a clean bill of health — a mostly-unknown score is an invitation
  // to open the record, not a verdict. Resolution rates across the live set are
  // measured by `npm run triage:measure` (see reports/triage-resolution-*.md);
  // valuation bands in particular arrive from harvested assessor rolls, so a
  // record without one says so instead of guessing.
  const unknownCount = data.summary?.unknown
    ?? data.signals.filter((s) => s.status === 'unknown').length;
  const weights = data.weights ?? {};

  return (
    <div className={cn("bg-card rounded-2xl border border-line shadow-sm overflow-hidden text-ink", compact && "p-4")}>
      {/* Header Banner */}
      <div className="bg-ink p-5 text-white flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">Research priority</h3>
<p className="text-xs text-white/75">
            {data.disclaimer || 'Deterministic evaluation with published weights. Not an appraisal or predictive distress score.'}
          </p>
        </div>

        {/* Score Dial / Badge */}
<div className="flex items-center gap-3 bg-white/10 px-4 py-2.5 rounded-xl border border-white/10">
          <div className="text-right">
            <p className="text-xs font-semibold text-white/60">Priority score</p>
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-2xl font-black text-white">{priority}</span>
              <span className="text-xs font-semibold text-white/60">/99</span>
            </div>
            <p className="text-[9px] text-white/60 mt-0.5">{data.signals.length}-signal · independent of modeled Deal Score</p>
          </div>
          <div
            className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wide shrink-0",
              isHigh && "bg-catch text-ink border border-catch",
              isMed && "bg-white/10 text-white/75 border border-white/20",
              !isHigh && !isMed && "bg-white/5 text-white/60 border border-white/10"
            )}
          >
            {unscored ? "No score" : isHigh ? "High Priority" : isMed ? "Moderate" : "Routine"}
          </div>
        </div>
      </div>

      {/* An unreadable observation store means the "nothing found" signals were
          never actually checked, so the score cannot be read as a clean result. */}
      {data.historyUnavailable && (
        <div className="flex items-start gap-2 border-b border-catch/30 bg-catch-wash px-5 py-3 text-xs text-catch-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            Observation history could not be read, so this score is incomplete. Signals that
            depend on prior observations are unverified rather than clear.
          </p>
        </div>
      )}

      {/* Published Weights Accordion */}
      <div className="border-b border-line bg-paper/70 px-5 py-3 text-xs">
        <button
          type="button"
          onClick={() => setShowWeights(!showWeights)}
          className="flex items-center justify-between w-full font-bold text-ink-2 hover:text-ink transition"
        >
          <span className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-ink-3" />
            <span>How this score works ({supportedCount} supported{unknownCount ? ` · ${unknownCount} needing checks` : ''} · {contradictedCount} conflicting)</span>
          </span>
          {showWeights ? <ChevronUp className="w-4 h-4 text-ink-3" /> : <ChevronDown className="w-4 h-4 text-ink-3" />}
        </button>

{showWeights && (
          <div className="mt-3 pt-3 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {Object.entries(weights).map(([key, value]) => {
              const detail = WEIGHT_DETAILS[key];
              if (!detail) return null;
              const comp = data.componentScores?.[key];
              const maxPts = comp?.maxPoints ?? Math.round(value * 100);
              const earnedPts = comp?.earnedPoints ?? 0;
              const fillPct = maxPts > 0 ? Math.min(100, Math.round((earnedPts / maxPts) * 100)) : 0;
              return (
                <div key={key} className="p-2.5 rounded-lg bg-card border border-line flex flex-col justify-between gap-1.5">
                  <div className="flex items-center justify-between font-semibold text-ink">
                    <span>{detail.label}</span>
                    <div className="flex items-center gap-1.5 text-right">
                      {comp ? (
                        <span className="font-mono text-[11px] font-bold text-ink-2">
                          {earnedPts} / {maxPts} <span className="text-[10px] text-ink-3 font-normal">pts</span>
                        </span>
                      ) : (
                        <span className="text-ink font-extrabold">{weightPercent(value)}</span>
                      )}
                    </div>
                  </div>
                  {/* Mini-bar */}
                  <div className="w-full bg-line rounded-full h-1.5 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        earnedPts > 0 ? "bg-ink-2" : "bg-line-strong"
                      )}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-ink-3">
                    <p className="leading-snug text-[10px]">{detail.desc}</p>
                    <span className="text-[10px] font-semibold text-ink-3 shrink-0 ml-1.5">{weightPercent(value)} wt</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Candidate Signals List */}
      <div className="p-5 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-2">
          Evidence checks ({data.signals.length})
        </h4>

        <div className="space-y-2.5">
          {data.signals.map((signal) => {
            const isSupported = signal.status === 'supported';
            const isContradicted = signal.status === 'contradicted';

            return (
              <div
                key={signal.key}
                className={cn(
                  "p-3.5 rounded-xl border transition text-xs",
                  isSupported && "bg-paper border-line",
                  isContradicted && "bg-catch-wash border-catch/30",
                  !isSupported && !isContradicted && "bg-card border-catch/30"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-ink">
                    {isSupported ? (
                      <CheckCircle2 className="w-4 h-4 text-ink-3 shrink-0" />
                    ) : isContradicted ? (
                      <AlertTriangle className="w-4 h-4 text-catch-ink shrink-0" />
                    ) : (
                      <HelpCircle className="w-4 h-4 text-catch-ink shrink-0" />
                    )}
                    <span>{signal.label}</span>
                  </div>

                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-extrabold uppercase shrink-0",
                      isSupported && "bg-line text-ink-2",
                      isContradicted && "bg-catch text-ink",
                      !isSupported && !isContradicted && "bg-catch-wash text-catch-ink"
                    )}
                  >
                    {signal.status === 'unknown' ? 'Needs checking' : signal.status === 'contradicted' ? 'Conflicting' : 'Supported'}
                  </span>
                </div>

                <p className="text-ink-2 leading-relaxed pl-6">{signal.reason}</p>

                <div className="mt-2 pt-2 border-t border-line pl-6 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="text-ink-2 font-semibold flex items-center gap-1">
                    <span>Next:</span>
                    <span>{signal.nextAction}</span>
                  </div>

                  <div className="text-ink-3 flex items-center gap-2">
                    <span className="text-xs">{signal.evidenceClass.replace(/_/g, ' ')}</span>
                    {signal.observedAt && (
                      <span className="text-[10px]">
                        observed {new Date(signal.observedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
