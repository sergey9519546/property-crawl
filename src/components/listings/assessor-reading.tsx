"use client";

import * as React from "react";
import { EnrichmentView } from "@/components/listings/enrichment-view";
import { useLocale } from "@/components/i18n/locale-provider";

export type AssessorReadingResponse = {
  enrolled?: boolean;
  found?: boolean;
  countyName?: string | null;
  field?: string | null;
  endpoint?: string | null;
  apn?: string | null;
  parcelKey?: string | null;
  landUse?: string | null;
  evidenceClass?: string | null;
  rawFigure?: number | null;
  marketComparison?: number | null;
  citation?: string | null;
  openingBid?: number | null;
  ratio?: number | null;
  dealScore?: number | null;
  withheldReason?: string | null;
  isAppraisal?: boolean;
};

const assessorReadingCache = new Map<string, Promise<AssessorReadingResponse>>();

export function fetchAssessorReadingCached(listingId: string): Promise<AssessorReadingResponse> {
  const key = listingId.trim();
  const cached = assessorReadingCache.get(key);
  if (cached) return cached;
  const request = fetch(`/api/listings/${encodeURIComponent(listingId)}/assessor`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Assessor lookup returned ${response.status}`);
      return response.json() as Promise<AssessorReadingResponse>;
    })
    .catch((err) => {
      assessorReadingCache.delete(key);
      throw err;
    });
  assessorReadingCache.set(key, request);
  return request;
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

export function AssessorReading({ listingId, hasServerParcelKey = false }: { listingId: string; hasServerParcelKey?: boolean }) {
  const { messages: m } = useLocale();
  const [reading, setReading] = React.useState<AssessorReadingResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setReading(null);
    void fetchAssessorReadingCached(listingId)
      .then((data) => {
        if (!cancelled) {
          setReading(data);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (status === "loading") {
    return <p className="mt-4 text-sm text-ink-3">{m.detailUi.assessorLoading}</p>;
  }
  if (status === "error" || !reading) {
    return <p className="mt-4 text-sm text-ink-2">{m.detailUi.assessorFailed}</p>;
  }

  const host = (() => {
    try {
      return reading.endpoint ? new URL(reading.endpoint).host : null;
    } catch {
      return null;
    }
  })();

  return (
    <div data-testid="assessor-reading" className="mt-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-paper p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{m.detailUi.countyFigureLabel}{reading.field ? ` · ${reading.field}` : ""}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">{money(reading.rawFigure)}</dd>
        </div>
        <div className="rounded-2xl bg-paper p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{m.detailUi.marketCompLabel}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">{money(reading.marketComparison)}</dd>
        </div>
        <div className="rounded-2xl bg-paper p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{m.detailUi.openingDivCompLabel}</dt>
          <dd className="mt-1 text-lg font-bold text-ink">
            {reading.dealScore != null ? reading.dealScore : "—"}
            {reading.ratio != null ? <span className="ml-2 text-sm font-semibold text-ink-3">{reading.ratio.toFixed(2)}</span> : null}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        {reading.countyName ? `${reading.countyName}. ` : ""}
        {reading.citation || reading.withheldReason}
        {reading.apn ? ` APN ${reading.apn}.` : ""}
        {reading.landUse ? ` ${reading.landUse}.` : ""}
        {host ? ` ${host}.` : ""}
        {" "}Assessor figure, not an appraisal. Evidence class {reading.evidenceClass || "assessor-figure-v1"}.
      </p>
      {!hasServerParcelKey && reading.parcelKey ? <EnrichmentView parcelKey={reading.parcelKey} /> : null}
    </div>
  );
}
