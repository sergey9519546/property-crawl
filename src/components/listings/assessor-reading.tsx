"use client";

import * as React from "react";

type AssessorReadingResponse = {
  enrolled?: boolean;
  found?: boolean;
  countyName?: string | null;
  field?: string | null;
  endpoint?: string | null;
  apn?: string | null;
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

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

export function AssessorReading({ listingId }: { listingId: string }) {
  const [reading, setReading] = React.useState<AssessorReadingResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setReading(null);
    void fetch(`/api/listings/${encodeURIComponent(listingId)}/assessor`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<AssessorReadingResponse>;
      })
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
    return <p className="mt-4 text-sm text-slate-600">Reading the county assessor layer…</p>;
  }
  if (status === "error" || !reading) {
    return <p className="mt-4 text-sm text-slate-700">Assessor lookup failed.</p>;
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
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">County figure{reading.field ? ` · ${reading.field}` : ""}</dt>
          <dd className="mt-1 text-lg font-bold text-slate-950">{money(reading.rawFigure)}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Market comparison</dt>
          <dd className="mt-1 text-lg font-bold text-slate-950">{money(reading.marketComparison)}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Opening ÷ comparison</dt>
          <dd className="mt-1 text-lg font-bold text-slate-950">
            {reading.dealScore != null ? reading.dealScore : "—"}
            {reading.ratio != null ? <span className="ml-2 text-sm font-semibold text-slate-600">{reading.ratio.toFixed(2)}</span> : null}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">
        {reading.countyName ? `${reading.countyName}. ` : ""}
        {reading.citation || reading.withheldReason}
        {reading.apn ? ` APN ${reading.apn}.` : ""}
        {reading.landUse ? ` ${reading.landUse}.` : ""}
        {host ? ` ${host}.` : ""}
        {" "}Assessor figure, not an appraisal. Evidence class {reading.evidenceClass || "assessor-figure-v1"}.
      </p>
    </div>
  );
}
