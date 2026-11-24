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
import { useLocale } from "@/components/i18n/locale-provider";

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
  code?: string | null;
  lookupSkippedReason?: string | null;
  docketSummary?: {
    status?: string;
    lookupExecuted?: boolean;
    lookupSkippedReason?: string | null;
  } | null;
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
  const { messages } = useLocale();
  const t = messages.docketParcel;
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfiguredAuth, setUnconfiguredAuth] = useState(false);

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
    setUnconfiguredAuth(false);

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
      const data = (await response.json()) as VerificationResult & { error?: string; code?: string };

      if (!response.ok) {
        const authDiag = `${data.code || ""} ${data.error || ""} ${data.lookupSkippedReason || ""}`;
        if (/COURTLISTENER_AUTH_REQUIRED|courtlistener_api_key_required/i.test(authDiag)) {
          setUnconfiguredAuth(true);
          return;
        }
        throw new Error(data.error || t.docketErrorDefault);
      }

      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setResult(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.docketErrorDefault;
      setError(message);
      setLogs([
        `[${new Date().toISOString().slice(11, 19)}] ${t.docketLogError}`,
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const evidence = (result?.officialEvidence || []).filter((item) => isSafeEvidenceUrl(item.url));
  const isVerified = Boolean(result?.verified && evidence.length > 0);
  const isUnconfiguredAuth = unconfiguredAuth || Boolean(
    result?.docketSummary?.lookupSkippedReason === "courtlistener_api_key_required"
    || result?.docketSummary?.lookupSkippedReason === "COURTLISTENER_AUTH_REQUIRED"
    || result?.lookupSkippedReason === "courtlistener_api_key_required"
    || result?.lookupSkippedReason === "COURTLISTENER_AUTH_REQUIRED"
    || result?.code === "COURTLISTENER_AUTH_REQUIRED"
  );

  return (
    <section className="space-y-4 rounded-card border border-white/10 bg-ink p-5 text-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-control border border-white/10 bg-white/10 text-white/75">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight">{t.docketHeading || "Court-record evidence check"}</h3>
              <span className="rounded-full border border-catch/30 bg-catch/10 px-2 py-0.5 text-label font-bold text-white/75">
                {t.docketBadge}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-white/60">
              {t.docketSub}
            </p>
          </div>
        </div>

        <button
          onClick={runVerification}
          disabled={isRunning || !canCheck}
          className="flex h-9 items-center gap-1.5 rounded-control bg-card px-3 text-xs font-bold text-ink transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
          <span>{isRunning ? t.docketChecking : t.docketRunBtn}</span>
        </button>
      </div>

      {!canCheck && (
        <div className="flex items-start gap-2 rounded-control border border-catch/30 bg-catch/10 p-4 text-xs text-white">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-catch" />
          {t.docketMissingLocation}
        </div>
      )}

      {(logs.length > 0 || isRunning) && !isUnconfiguredAuth && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-white/10 bg-black/50 p-4 font-mono text-label leading-relaxed text-white/75">
          <div className="mb-2 flex items-center gap-2 border-b border-white/5 pb-2 text-meta uppercase tracking-wider text-white/60">
            <Terminal className="h-3 w-3 text-white/60" />
            {t.docketLogTitle}
          </div>
          {logs.map((log, index) => (
            <div key={`${index}-${log}`}>{log}</div>
          ))}
          {isRunning && <div className="animate-pulse text-go-fill">{t.docketLogRunning}</div>}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-control border border-catch/30 bg-catch/10 p-4 text-xs text-white">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-catch" />
          {error}
        </div>
      )}

      {isUnconfiguredAuth && evidence.length === 0 && (
        <div
          data-testid="docket-unconfigured-disclosure"
          className="rounded-control border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60"
        >
          {t.docketNotVerified || "Not verified from official records"} · Live federal docket lookup is not configured (COURTLISTENER_API_KEY unset).
        </div>
      )}

      {result && !(isUnconfiguredAuth && evidence.length === 0) && (
        <div className={`space-y-4 rounded-control border p-4 ${
          isVerified
            ? "border-white/10 bg-white/5"
            : "border-catch/30 bg-catch/10"
        }`}>
          <div className="flex items-start gap-3">
            {isVerified ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/75" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-catch" />
            )}
            <div>
              <p className={`text-xs font-extrabold uppercase tracking-wide ${
                isVerified ? "text-white/75" : "text-white"
              }`}>
                {isVerified ? t.docketVerified : (t.docketNotVerified || "Not verified from official records")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/75">{result.statusReason}</p>
            </div>
          </div>

          {!isVerified && result.missingEvidence?.length > 0 && (
            <div>
              <p className="text-label font-bold uppercase tracking-wider text-white/60">{t.docketEvidenceNeeded}</p>
              <ul className="mt-2 grid gap-1.5 text-xs text-white/75 sm:grid-cols-2">
                {result.missingEvidence.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-catch" />
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
                  className="inline-flex items-center gap-1.5 rounded-control bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
                >
                  {item.label} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          )}

          <p className="border-t border-white/10 pt-3 text-label leading-relaxed text-white/75">
            {result.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
