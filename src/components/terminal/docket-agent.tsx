"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  FileWarning,
  RefreshCw,
  Scale,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { PropertyListing } from "./property-data";

interface DocketAgentProps {
  listing: PropertyListing | null;
  customAddress?: string;
}

interface OfficialEvidence {
  label: string;
  url: string;
  fetchedAt?: string | null;
}

export interface VerificationResult {
  verified: boolean;
  verificationState: string;
  checkedAt?: string | null;
  address: string;
  county: string;
  state: string;
  caseNumber?: string | null;
  status: string;
  statusReason: string;
  titleIntegrity: string;
  officialEvidence: OfficialEvidence[];
  missingEvidence: string[];
  logs: string[];
  disclaimer: string;
  summaryMarkdown: string;
}

function isSafeEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function DocketAgent({ listing, customAddress }: DocketAgentProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveAddress = listing?.address || customAddress || "";
  const effectiveCounty = listing?.county || "";
  const effectiveState = listing?.state || "";
  const canCheck = Boolean(effectiveAddress && effectiveCounty && effectiveState);

  const runVerification = async () => {
    if (!canCheck) return;

    setIsRunning(true);
    setLogs([]);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/verify-docket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing?.id,
          address: effectiveAddress,
          county: effectiveCounty,
          state: effectiveState,
        }),
      });
      const data = (await response.json()) as VerificationResult & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Official-record evidence check failed");
      }

      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setResult(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Official-record evidence check failed";
      setError(message);
      setLogs([
        `[${new Date().toISOString().slice(11, 19)}] Evidence check failed. No verification result was issued.`,
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const evidence = (result?.officialEvidence || []).filter((item) => isSafeEvidenceUrl(item.url));
  const isVerified = Boolean(result?.verified && evidence.length > 0);

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-[#0F172A] p-5 text-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight">Court-record evidence check</h3>
              <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                Official source required
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-slate-400">
              Checks whether court, recorder, tax, and bankruptcy evidence is actually attached. It never infers legal status from an address or AI response.
            </p>
          </div>
        </div>

        <button
          onClick={runVerification}
          disabled={isRunning || !canCheck}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
          <span>{isRunning ? "Checking evidence..." : "Check official evidence"}</span>
        </button>
      </div>

      {!canCheck && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs text-amber-100">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          Address, county, and state are required before an evidence check can run.
        </div>
      )}

      {(logs.length > 0 || isRunning) && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
          <div className="mb-2 flex items-center gap-2 border-b border-white/5 pb-2 text-[10px] uppercase tracking-wider text-slate-500">
            <Terminal className="h-3 w-3 text-amber-300" />
            Evidence audit log
          </div>
          {logs.map((log, index) => (
            <div key={`${index}-${log}`}>{log}</div>
          ))}
          {isRunning && <div className="animate-pulse text-amber-300">&gt; Checking attached evidence...</div>}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-xs text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className={`space-y-4 rounded-xl border p-4 ${
          isVerified
            ? "border-emerald-400/30 bg-emerald-400/10"
            : "border-amber-400/30 bg-amber-400/10"
        }`}>
          <div className="flex items-start gap-3">
            {isVerified ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            )}
            <div>
              <p className={`text-xs font-extrabold uppercase tracking-wide ${
                isVerified ? "text-emerald-200" : "text-amber-200"
              }`}>
                {isVerified ? "Verified from attached official evidence" : "Not verified from official records"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-200">{result.statusReason}</p>
            </div>
          </div>

          {!isVerified && result.missingEvidence?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Evidence still required</p>
              <ul className="mt-2 grid gap-1.5 text-xs text-slate-200 sm:grid-cols-2">
                {result.missingEvidence.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evidence.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {evidence.map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
                >
                  {item.label} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          )}

          <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-300">
            {result.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
