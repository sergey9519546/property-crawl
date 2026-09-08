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

export type OpportunitySignalsData = {
  triagePriority: number;
  signals: OpportunitySignal[];
  weights?: Record<string, number>;
  summary?: { supported: number; unknown: number; contradicted: number };
  disclaimer?: string;
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
  dataCompleteness: { label: 'Data Completeness', desc: 'Measures how many of the six candidate signals resolved to supported evidence.' },
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
      <div className="flex items-center justify-center p-6 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
        <span>Checking research signals…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
        <span>{error || 'Signals currently unavailable for this listing'}</span>
      </div>
    );
  }

  const priority = data.triagePriority ?? 0;
  const isHigh = priority >= 70;
  const isMed = priority >= 50 && priority < 70;

const supportedCount = data.summary?.supported ?? data.signals.filter((s) => s.status === 'supported').length;
  const contradictedCount = data.summary?.contradicted ?? data.signals.filter((s) => s.status === 'contradicted').length;
  const weights = data.weights ?? {};

  return (
    <div className={cn("bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-slate-900", compact && "p-4")}>
      {/* Header Banner */}
      <div className="bg-[#0F172A] p-5 text-white flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">Research priority</h3>
<p className="text-xs text-slate-300">
            {data.disclaimer || 'Deterministic evaluation with published weights. Not an appraisal or predictive distress score.'}
          </p>
        </div>

        {/* Score Dial / Badge */}
<div className="flex items-center gap-3 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700">
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-400">Priority score</p>
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-2xl font-black text-white">{priority}</span>
              <span className="text-xs font-semibold text-slate-400">/99</span>
            </div>
            <p className="text-[9px] text-slate-500 mt-0.5">6-signal · independent of modeled Deal Score</p>
          </div>
          <div
            className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wide shrink-0",
              isHigh && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
              isMed && "bg-amber-500/20 text-amber-300 border border-amber-500/40",
              !isHigh && !isMed && "bg-slate-700 text-slate-300 border border-slate-600"
            )}
          >
            {isHigh ? 'High Priority' : isMed ? 'Moderate' : 'Routine'}
          </div>
        </div>
      </div>

      {/* Published Weights Accordion */}
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs">
        <button
          type="button"
          onClick={() => setShowWeights(!showWeights)}
          className="flex items-center justify-between w-full font-bold text-slate-700 hover:text-slate-900 transition"
        >
          <span className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-slate-500" />
            <span>How this score works ({supportedCount} supported · {contradictedCount} conflicting)</span>
          </span>
          {showWeights ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>

{showWeights && (
          <div className="mt-3 pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {Object.entries(weights).map(([key, value]) => {
              const detail = WEIGHT_DETAILS[key];
              if (!detail) return null;
              return (
                <div key={key} className="p-2 rounded-lg bg-white border border-slate-200 flex flex-col justify-between">
                  <div className="flex items-center justify-between font-semibold text-slate-900">
                    <span>{detail.label}</span>
                    <span className="text-emerald-700 font-extrabold">{weightPercent(value)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">{detail.desc}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Candidate Signals List */}
      <div className="p-5 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
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
                  isSupported && "bg-emerald-50/40 border-emerald-200/80",
                  isContradicted && "bg-rose-50/40 border-rose-200/80",
                  !isSupported && !isContradicted && "bg-slate-50/60 border-slate-200"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-slate-950">
                    {isSupported ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : isContradicted ? (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    ) : (
                      <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span>{signal.label}</span>
                  </div>

                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-extrabold uppercase shrink-0",
                      isSupported && "bg-emerald-100 text-emerald-800",
                      isContradicted && "bg-rose-100 text-rose-800",
                      !isSupported && !isContradicted && "bg-slate-200 text-slate-700"
                    )}
                  >
                    {signal.status === 'unknown' ? 'Needs checking' : signal.status === 'contradicted' ? 'Conflicting' : 'Supported'}
                  </span>
                </div>

                <p className="text-slate-700 leading-relaxed pl-6">{signal.reason}</p>

                <div className="mt-2 pt-2 border-t border-slate-200/60 pl-6 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="text-emerald-800 font-semibold flex items-center gap-1">
                    <span>Next:</span>
                    <span>{signal.nextAction}</span>
                  </div>

                  <div className="text-slate-400 flex items-center gap-2">
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
