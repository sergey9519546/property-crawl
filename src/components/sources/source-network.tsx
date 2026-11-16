"use client";
// CLS on this route sits at 0.084, under Google's 0.1 threshold, and is NOT
// understood. Recorded so the next person does not repeat the work.
//
// The layout-shift entries name two `section.mt-9` blocks -- the coverage matrix
// and "Explore the network" -- reporting them collapsing to zero height. Two
// hypotheses were built, measured, and REJECTED:
//
//   1. The source-status summary was conditional on `data`, so it appeared from
//      nothing when the payload landed. Rendering it unconditionally with a
//      placeholder: 0.0843 -> 0.0822. Within noise. Reverted.
//   2. The loading state was a 96px <p> that expanded into a multi-thousand-
//      pixel grid. Replacing it with a shape-accurate skeleton of 10 cards:
//      0.0842. Unchanged. Reverted.
//
// The value is stable to three decimals across both experiments while the
// *timing* moved from 625ms to 1731ms to 3955ms. A stable magnitude with a
// wildly unstable time is not what a content swap looks like, and the
// `sources` attribution is evidently pointing at where the browser noticed
// rather than at what moved.
//
// A third instrument explains why neither fix could have worked. Sampling every
// element's bounding rect on a timer from first paint -- ignoring layout-shift
// entirely -- shows the real change is at t=595ms and is enormous: fourteen
// elements move by 3,962px to 29,765px, all at the same instant, all below the
// source cards. That is the cards grid expanding and shoving the rest of the
// page down.
//
// And that is exactly why fixing the loading state moved nothing. A shift of
// 29,000px pushes an element clean out of the viewport, and CLS only scores
// shifts inside the viewport. The two symptoms are unrelated, which is why
// treating the first as a cause of the second produced no change.
//
// So the page has one real, large, unscored layout change, and a separate
// 0.084 of in-viewport movement that no instrument here has isolated. The
// latter is under the threshold and nothing else about the page is wrong, so
// this stops. Closing it needs viewport-clipped geometry capture, not a bigger
// skeleton and not another content hypothesis.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { sourceDisplayText } from "@/lib/source-display";
import { taxonomySummary, taxonomyBadge } from "@/lib/source-taxonomy";
import {
  formatSourceScope,
  formatSourceScopeSummary,
} from "@/lib/source-scope-label";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ExternalLink,
  FilePlus2,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import {
  SourceAtlas,
  type SourceAtlasData,
} from "@/components/sources/source-atlas";

type SourceRunCoverage = {
  scope?: unknown;
  acquisitionScope?: unknown;
  discovered?: number;
  accepted?: number;
  rejected?: number;
  complete?: boolean;
  lastRunAt?: string;
  trigger?: string;
  error?: string | null;
  scopeHash?: string;
};

type SourceReleaseGate = {
  state?: string;
  cleanRuns?: number;
  requiredRuns?: number;
  approved?: boolean;
  evidenceQualified?: boolean;
  scopeMatchesLatest?: boolean;
};

type Source = {
  id: string;
  label: string;
  category: string;
  role: string;
  coverage: string | SourceRunCoverage | null;
  organization?: string;
  propertyLookup?: boolean;
  discoveryUrl: string;
  access: string;
  adapterKey: string | null;
  discoveryStatus?: string;
  releaseGate?: SourceReleaseGate;
  workflow: {
    primary: string;
    fallback: string;
    cadenceHours: number;
    steps: string[];
  };
  requiredEvidence: string[];
  notes: string;
  automated: boolean;
  status: string;
  /** Catalog trust taxonomy. Distinct vocabulary from `status` -- see src/lib/source-taxonomy.ts. */
  trustStatus?: string;
  observedRecords: number;
  observedStates: string[];
  latestObservation: string | null;
  automatedEvidence: boolean;
  evidencePackets: number;
  dueAt: string | null;
  nextAction: string;
  lastRun: {
    lastRunAt: string;
    acceptedCount: number;
    error: string | null;
  } | null;
};
type Signal = {
  id: string;
  sourceId: string;
  listingId: string;
  address: string;
  title: string;
  field: string;
  before: string | number;
  after: string | number;
  observedAt: string;
  evidence: { sourceUrl: string; observedAt: string; value: unknown }[];
  nextStep: string;
};
type Network = {
  sources: Source[];
  signals: Signal[];
  collectionRunning: boolean;
  collectionHealth?: { status: "healthy" | "stale" | "not_started" | "disabled"; degraded: boolean; lastSeenAt: string | null; lastLoopStatus: string | null; currentJobId: string | null; backlog: { queued: number; expiredRunning: number } };
  inventoryTruncated: boolean;
  evidenceQueueError: boolean;
  historyUnavailable: boolean;
  /** The observation store's Postgres facts (migrations 025 + 027). Null when Postgres is unreachable. */
  observationStore?: {
    store: "postgres";
    rows: number;
    trackedRecords: number;
    oldestObservedAt: string | null;
    newestObservedAt: string | null;
    tableBytes: number;
    willExceedCeiling: boolean;
  } | null;
  summary: {
    catalogSources: number;
    automatedCollectors: number;
    collected: number;
    needsAttention: number;
    importSources: number;
    observedRecords: number;
    /** Observation-history index size. Retains entries for records the store no longer holds, so it is NOT the inventory count. */
    trackedRecords: number;
    /** Records currently in the store, summed per distinct adapter. Matches /api/listings total. */
    storedRecords?: number;
  };
  atlas?: SourceAtlasData;
  storageMode?: string;
};
const STATUS: Record<string, { label: string; color: string }> = {
  lookup_available: {
    label: "Property lookup",
    color: "bg-paper text-ink-2",
  },
  collected: {
    label: "Recently collected",
    color: "bg-go-wash text-go",
  },
  awaiting_run: {
    label: "Collector registered · not run",
    color: "bg-paper text-ink-2",
  },
  import_available: {
    label: "Evidence import",
    color: "bg-paper text-ink-3",
  },
  attention: {
    label: "Collection needs attention",
    color: "bg-catch-wash text-catch-ink",
  },
  stale: { label: "Refresh due", color: "bg-catch-wash text-catch-ink" },
  empty: { label: "No records returned", color: "bg-paper text-ink-3" },
  evidence_queued: {
    label: "Notices in review queue",
    color: "bg-paper text-ink-2",
  },
  history_unavailable: {
    label: "History unavailable",
    color: "bg-catch-wash text-catch-ink",
  },
  manual: {
    label: "Manual lookup only",
    color: "bg-paper text-ink-2",
  },
  blocked: {
    label: "Access blocked",
    color: "bg-catch-wash text-catch-ink",
  },
  operational: {
    label: "Recent collection succeeded",
    color: "bg-go-wash text-go",
  },
  collecting: {
    label: "Collection in progress",
    color: "bg-yours-wash text-yours",
  },
  partial: {
    label: "Partial collection",
    color: "bg-catch-wash text-catch-ink",
  },
  archived: {
    label: "Archive only",
    color: "bg-paper text-ink-2",
  },
};

// Both the trust summary and the per-source trust badge live in
// src/lib/source-taxonomy.ts so a test can reach them. Each used to live here,
// and each read `status` -- the OPERATIONAL state (collected / attention /
// stale / ...), which shares no values with the catalog taxonomy. The summary
// printed four permanent zeros; the badge resolved to null and never rendered
// once, so the page showed no trust information at all.

/** Known per-county coverage presets keyed by catalog source id or adapterKey. */
type CoverageDimension =
  | "assessor"
  | "recorder"
  | "foreclosure"
  | "taxSale"
  | "parcelMap"
  | "documentImages";

const COVERAGE_DIMENSIONS: CoverageDimension[] = [
  "assessor",
  "recorder",
  "foreclosure",
  "taxSale",
  "parcelMap",
  "documentImages",
];

const COVERAGE_DIMENSION_LABELS: Record<CoverageDimension, string> = {
  assessor: "Assessor",
  recorder: "Recorder",
  foreclosure: "Foreclosure",
  taxSale: "Tax sale",
  parcelMap: "Parcel map",
  documentImages: "Document images",
};

type LiveCoveragePayload = {
  catalog?: { total?: number; statesCovered?: number };
  states?: string[] | Array<{ state: string; catalogCount?: number; liveCount?: number }>;
  liveByState?: {
    byStateSource?: Record<string, Record<string, { count?: number; observed?: string | null }>>;
    byStateTotal?: Record<string, number>;
    byCounty?: Record<string, Array<{ county: string; count: number; sources: string[] }>>;
    totalRecords?: number;
    countedRecords?: number;
    storeStatus?: string;
    readError?: string | null;
  };
};

type CoveragePreset = {
  countyCount: number;
  countyLabel: string;
  dimensions: Partial<Record<CoverageDimension, boolean>>;
};

const COVERAGE_PRESETS: Record<string, CoveragePreset> = {
  hud: {
    countyCount: 52,
    countyLabel: "52 HUD jurisdictions unless HUD_STATES is set — page budget stays bounded",
    dimensions: { foreclosure: true, documentImages: true },
  },
  "hud-homestore": {
    countyCount: 52,
    countyLabel: "52 HUD jurisdictions unless HUD_STATES is set — page budget stays bounded",
    dimensions: { foreclosure: true, documentImages: true },
  },
  servicelink: {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true, documentImages: true },
  },
  civilview: {
    countyCount: 1,
    countyLabel: "OH Allen promoted run scope — not nationwide",
    dimensions: { foreclosure: true },
  },
  "fl-dor-cadastral": {
    countyCount: 67,
    countyLabel: "67 FL counties",
    dimensions: { assessor: true, parcelMap: true },
  },
  courtlistener: {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true },
  },
  treasury: {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true },
  },
  "treasury-forfeiture": {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true },
  },
  irs: {
    countyCount: 0,
    countyLabel: "Public IRS real-estate auction index",
    dimensions: {},
  },
  "irs-auctions": {
    countyCount: 0,
    countyLabel: "Public IRS real-estate auction index",
    dimensions: {},
  },
  gsa: {
    countyCount: 0,
    countyLabel: "Accelerated-disposition list on gsa.gov",
    dimensions: {},
  },
  "gsa-real-estate-sales": {
    countyCount: 0,
    countyLabel: "Accelerated-disposition list on gsa.gov",
    dimensions: {},
  },
  usda: {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true },
  },
  "usda-resales": {
    countyCount: 0,
    countyLabel: "Nationwide",
    dimensions: { foreclosure: true },
  },
};

function coveragePresetFor(source: Source): CoveragePreset | null {
  return (
    COVERAGE_PRESETS[source.id] ??
    (source.adapterKey ? COVERAGE_PRESETS[source.adapterKey] : null) ??
    null
  );
}

function serverDerivedCoverage(
  source: Source,
  preset: CoveragePreset | null,
  liveStats: ReturnType<typeof liveCoverageForSource>,
): { hasMapping: boolean; label: string; dimensions: Partial<Record<CoverageDimension, boolean>> } {
  const dims: Partial<Record<CoverageDimension, boolean>> = { ...(preset?.dimensions || {}) };
  const text = `${source.category} ${source.role} ${source.label} ${source.notes} ${source.workflow?.primary || ""} ${(source.requiredEvidence || []).join(" ")}`.toLowerCase();

  if (/tax|deed|treasurer|tax_sale/.test(text)) dims.taxSale = true;
  if (/foreclosure|sheriff|trustee|distress|auction|hud|usda|treasury|irs|gsa|fannie|freddie|fdic|marshal|va/.test(text)) {
    dims.foreclosure = true;
  }
  if (/assessor|cadastral|valuation|appraisal/.test(text)) dims.assessor = true;
  if (/recorder|clerk|instrument|deed|lien|docket/.test(text)) dims.recorder = true;
  if (/parcel|gis|shapefile|boundary|map/.test(text) || source.propertyLookup) dims.parcelMap = true;
  if (/document|pdf|image|notice|filings|exhibits/.test(text) || source.requiredEvidence?.length > 0) {
    dims.documentImages = true;
  }

  const hasDims = Object.values(dims).some(Boolean);
  const hasMapping = Boolean(preset || hasDims || (liveStats && liveStats.recordCount > 0) || source.observedRecords > 0 || source.automated);
  const label = preset?.countyLabel || coverageDescription(source.coverage) || (source.observedStates?.length ? `${source.observedStates.length} observed states` : source.category);
  return { hasMapping, label, dimensions: dims };
}
function liveCoverageForSource(
  source: Source,
  liveCoverage: LiveCoveragePayload | null,
) {
  const liveByState = liveCoverage?.liveByState;
  if (!liveByState?.byStateSource) return null;
  const candidateKeys = new Set(
    [source.id, source.adapterKey].filter((v): v is string => typeof v === "string" && v.length > 0),
  );
  let recordCount = 0;
  let stateCount = 0;
  const counties = new Set<string>();
  for (const [st, sourceMap] of Object.entries(liveByState.byStateSource)) {
    let stateHits = 0;
    for (const [srcKey, stats] of Object.entries(sourceMap || {})) {
      if (candidateKeys.has(srcKey) && Number.isFinite(stats?.count)) {
        stateHits += Number(stats.count);
      }
    }
    if (stateHits > 0) {
      stateCount += 1;
      recordCount += stateHits;
      const countyRows = liveByState.byCounty?.[st] || [];
      for (const row of countyRows) {
        if (Array.isArray(row.sources) && row.sources.some((s) => candidateKeys.has(s))) {
          counties.add(`${st}:${row.county}`);
        }
      }
    }
  }
  return { recordCount, stateCount, countyCount: counties.size };
}
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet observed";
const moneyOrText = (signal: Signal, value: string | number) =>
  signal.field === "openingBid"
    ? Number(value).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    : String(value);

function coverageSummary(source: Source) {
  if (source.observedRecords) return `${source.observedRecords} observed records · ${source.observedStates.join(", ") || "state not published"}`;
  if (source.evidencePackets) return `${source.evidencePackets} evidence packets · review required`;
  const status = source.discoveryStatus || source.status;
  if (status === "awaiting_run") return "Collector registered; no successful collection has been recorded.";
  if (status === "manual" || status === "lookup_available") return "Manual lookup; no collected property records are claimed.";
  if (status === "blocked") return "Latest collection was blocked; review the access path before retrying.";
  if (status === "attention" || status === "partial") return "Collection needs review before relying on its coverage.";
  if (status === "import_available") return "Requires a reviewed import; no live coverage is claimed.";
  return "Open the workflow to review access and evidence requirements.";
}

function coverageDescription(coverage: Source["coverage"]) {
  if (coverage == null) return "No operational collection coverage recorded.";
  if (typeof coverage === "string") return sourceDisplayText(coverage);
  const discovered = Number.isFinite(coverage.discovered) ? coverage.discovered : null;
  const accepted = Number.isFinite(coverage.accepted) ? coverage.accepted : null;
  const rejected = Number.isFinite(coverage.rejected) ? coverage.rejected : null;
  const completion = coverage.error ? "Collection error" : coverage.complete === true ? "Collection completed" : "Collection incomplete";
  const counts = discovered !== null || accepted !== null || rejected !== null
    ? `${accepted ?? 0} accepted · ${rejected ?? 0} rejected · ${discovered ?? 0} discovered`
    : "Record counts not reported";
  return `${completion} · ${counts} · ${formatSourceScopeSummary(coverage.acquisitionScope ?? coverage.scope)}`;
}

function coverageScopeDetails(coverage: Source["coverage"]) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    return null;
  }
  const scope = coverage.acquisitionScope ?? coverage.scope;
  const summary = formatSourceScopeSummary(scope);
  const exact = formatSourceScope(scope);
  return summary === exact ? null : exact;
}

function releaseGateMessage(source: Source) {
  const gate = source.releaseGate;
  if (!gate || (gate.approved !== false && gate.scopeMatchesLatest !== false)) return null;
  const coverage = source.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage) || coverage.complete !== true) {
    return null;
  }
  const cleanRuns = typeof gate.cleanRuns === "number" && Number.isFinite(gate.cleanRuns) ? gate.cleanRuns : 0;
  const requiredRuns = typeof gate.requiredRuns === "number" && Number.isFinite(gate.requiredRuns) ? gate.requiredRuns : 2;
  if (gate.scopeMatchesLatest === false) {
    return "Latest sweep completed, but its scope does not match the recurring collection evidence. Approval remains blocked.";
  }
  if (gate.evidenceQualified === true) {
    return `Latest sweep completed for the recorded scope; recurring collection approval is pending (${cleanRuns}/${requiredRuns} clean runs).`;
  }
  if (gate.state !== "canary" || cleanRuns < 1) {
    return "Latest sweep completed for the recorded scope; recurring collection is not approved.";
  }
  return `Latest sweep completed for the recorded scope; recurring collection approval is pending (${cleanRuns}/${requiredRuns} clean runs).`;
}

function sourceStatus(source: Source) {
  const gate = source.releaseGate;
  const gateMessage = releaseGateMessage(source);
  if (gateMessage) {
    return {
      label: source.releaseGate?.scopeMatchesLatest === false ? "Approval blocked" : "Approval pending",
      color: "bg-catch-wash text-catch-ink",
    };
  }
  // Approved collection gate is stronger than publisher catalog status alone.
  if (gate && gate.approved === true) {
    return {
      label: "Collection approved",
      color: "bg-go-wash text-go",
    };
  }
  return STATUS[source.discoveryStatus || source.status] || {
    label: label(source.discoveryStatus || source.status),
    color: "bg-paper text-ink-3",
  };
}

function collectionProblem(source: Source) {
  const gate = source.releaseGate;
  const gateMessage = releaseGateMessage(source);
  if (gateMessage) return gateMessage;
  if (gate && gate.approved === true) {
    const scope = formatSourceScopeSummary(
      source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage)
        ? source.coverage.acquisitionScope ?? source.coverage.scope
        : null
    );
    const hint = scope && scope !== "unknown" ? ` (${scope})` : "";
    return `Recurring collection approved${hint}. Promoted collection scope may be narrower than publisher catalog coverage — do not treat this as nationwide inventory.`;
  }
  const status = source.discoveryStatus || source.status;
  const coverageError = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage)
    && typeof source.coverage.error === "string"
    ? source.coverage.error.trim()
    : null;
  const lastRunError = typeof source.lastRun?.error === "string" ? source.lastRun.error.trim() : null;
  const error = lastRunError || coverageError;
  if (error) return `Latest collection failed: ${error}`;
  if (status === "blocked") return "The publisher could not be accessed. Use the fallback workflow before relying on coverage.";
  if (status === "attention") return "The latest collection needs review before this source can support coverage claims.";
  if (status === "partial") return "Only part of the configured source scope was collected. Review the latest run before relying on coverage.";
  if (status === "empty") return "The collection ran but returned no records. Confirm the publisher scope before treating this as no inventory.";
  return null;
}

export function SourceNetwork() {
  const session = useWorkspaceSession();
  const [data, setData] = useState<Network | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [role, setRole] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [kind, setKind] = useState("text");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customId, setCustomId] = useState("");
  const [customHomepage, setCustomHomepage] = useState("");
  const [customOrganization, setCustomOrganization] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [showCoverageMatrix, setShowCoverageMatrix] = useState(false);
  const [liveCoverage, setLiveCoverage] = useState<{
    catalog?: { total?: number; statesCovered?: number };
    states?: string[] | Array<{ state: string; catalogCount?: number; liveCount?: number }>; liveByState?: LiveCoveragePayload["liveByState"];
  } | null>(null);
  const [onboardingItems, setOnboardingItems] = useState<Array<{ key?: string; id?: string; status?: string }> | null>(null);
  const [unbrowseStatus, setUnbrowseStatus] = useState<{
    installed?: boolean;
    consentAccepted?: boolean;
    status?: string;
  } | null>(null);
  const [runningOnboarding, setRunningOnboarding] = useState(false);
  const [activeJob, setActiveJob] = useState<{
    id: string;
    sourceId?: string;
    status?: string;
    acceptedCount?: number;
    error?: string | null;
  } | null>(null);
  const [collectingSourceId, setCollectingSourceId] = useState<string | null>(null);
  const [showUnbrowseIntake, setShowUnbrowseIntake] = useState(false);
  const [unbrowseSourceId, setUnbrowseSourceId] = useState("");
  const [unbrowseSourceUrl, setUnbrowseSourceUrl] = useState("");
  const [unbrowseEndpointUrl, setUnbrowseEndpointUrl] = useState("");
  const [unbrowseVersion, setUnbrowseVersion] = useState("1.0.0");
  const [unbrowseNotes, setUnbrowseNotes] = useState("");
  const [reviewItems, setReviewItems] = useState<
    | {
        id: string;
        sourceId: string;
        sourceUrl: string;
        capturedAt: string;
        status: string;
        original?: unknown;
        review?: { decision: string };
      }[]
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coverage", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setLiveCoverage(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showCoverageMatrix]);

  useEffect(() => {
    if (!session.authenticated) return;
    let cancelled = false;
    fetch("/api/source-network/onboarding", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.items)) setOnboardingItems(body.items);
      })
      .catch(() => {});
    fetch("/api/source-network/unbrowse/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setUnbrowseStatus(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.authenticated]);

  useEffect(() => {
    if (!activeJob?.id) return;
    if (["completed", "succeeded", "failed", "error", "cancelled"].includes(String(activeJob.status || "").toLowerCase())) {
      return;
    }
    let cancelled = false;
    let polls = 0;
    const pollJob = async () => {
      polls += 1;
      try {
        const res = await fetch(`/api/source-network/jobs/${encodeURIComponent(activeJob.id)}`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!cancelled && res.ok && body?.job) {
          const nextStatus = String(body.job.status || activeJob.status || "running");
          setActiveJob({
            id: activeJob.id,
            sourceId: body.job.sourceId || activeJob.sourceId,
            status: nextStatus,
            acceptedCount: body.job.acceptedCount,
            error: body.job.error || null,
          });
          if (["completed", "succeeded", "failed", "error", "cancelled"].includes(nextStatus.toLowerCase())) {
            setMessage(
              body.job.error
                ? `Collection job ${activeJob.id} failed: ${body.job.error}`
                : `Collection job ${activeJob.id} finished (${nextStatus}${typeof body.job.acceptedCount === "number" ? ` · ${body.job.acceptedCount} accepted` : ""}).`,
            );
            void refresh();
            return;
          }
        }
      } catch {
        // Keep polling on transient network blip up to max polls
      }
      if (!cancelled && polls < 20) {
        timer = setTimeout(pollJob, 1500);
      }
    };
    let timer = setTimeout(pollJob, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeJob?.id, activeJob?.status]);

  async function collectSource(sourceId: string) {
    if (!session.authenticated) {
      session.requestUnlock();
      setMessage("Unlock the private workspace to collect a source.");
      return;
    }
    setCollectingSourceId(sourceId);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/collect`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `${sourceId}-${Date.now()}` }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Collection request failed (HTTP ${response.status})`);
      }
      if (result.job?.id && /^job_[a-f0-9]{24}$/.test(result.job.id)) {
        setActiveJob({
          id: result.job.id,
          sourceId,
          status: result.job.status || "queued",
        });
        setMessage(`Collection job ${result.job.id} queued for ${sourceId}. Monitoring job status…`);
      } else {
        setMessage(
          `Source ${sourceId} collection ${result.status || "complete"}${typeof result.acceptedCount === "number" ? ` (${result.acceptedCount} accepted)` : ""}.`,
        );
        await refresh();
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not collect this source.");
    } finally {
      setCollectingSourceId(null);
      setBusy(false);
    }
  }

  async function submitUnbrowseCandidate(event: React.FormEvent) {
    event.preventDefault();
    if (!session.authenticated) {
      session.requestUnlock();
      setMessage("Unlock the private workspace to submit Unbrowse route candidates.");
      return;
    }
    const sourceKey = (unbrowseSourceId || selected?.id || "").trim().toLowerCase();
    const targetSourceUrl = (unbrowseSourceUrl || selected?.discoveryUrl || "").trim();
    const targetEndpointUrl = unbrowseEndpointUrl.trim();
    if (!sourceKey || !targetSourceUrl || !targetEndpointUrl) {
      setMessage("Source ID, publisher URL, and observed endpoint URL are required.");
      return;
    }
    const nowIso = new Date().toISOString();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/source-network/unbrowse/intake", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "property-crawl.unbrowse-route-candidate/v1",
          source: sourceKey,
          sourceUrl: targetSourceUrl,
          method: "GET",
          reviewStatus: "pending",
          generatedAt: nowIso,
          evidence: {
            provider: "unbrowse",
            version: (unbrowseVersion || "1.0.0").trim().slice(0, 40),
            endpointUrl: targetEndpointUrl,
            observedAt: nowIso,
            ...(unbrowseNotes.trim() ? { notes: unbrowseNotes.trim().slice(0, 500) } : {}),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Unbrowse intake failed (HTTP ${response.status})`);
      }
      setUnbrowseEndpointUrl("");
      setUnbrowseNotes("");
      setShowUnbrowseIntake(false);
      setMessage(`Unbrowse route candidate accepted for ${sourceKey} (${result.candidateSchema || "pending review"}).`);
      await Promise.all([refresh(), loadReviewQueue()]);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unbrowse candidate intake failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runOnboardingPass() {
    setRunningOnboarding(true);
    try {
      const response = await fetch("/api/source-network/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        const refreshed = await fetch("/api/source-network/onboarding", { cache: "no-store" });
        const refBody = await refreshed.json().catch(() => ({}));
        if (Array.isArray(refBody.items)) setOnboardingItems(refBody.items);
        setMessage(`Onboarding spider pass finished (${result.probed ?? 0} probed).`);
      } else {
        setMessage(result.error || "Onboarding spider pass could not run.");
      }
    } catch {
      setMessage("Onboarding spider pass failed.");
    } finally {
      setRunningOnboarding(false);
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/source-network", {
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || `Could not load source coverage (HTTP ${response.status})`);
      setData(result);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load source coverage",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!data?.collectionRunning) return;
    const timeout = setTimeout(() => void refresh(), 8000);
    return () => clearTimeout(timeout);
  }, [data?.collectionRunning, data, refresh]);

  const categories = useMemo(
    () =>
      [...new Set(data?.sources.map((source) => source.category) || [])].sort(),
    [data],
  );
  const sources = useMemo(
    () =>
      (data?.sources || []).filter(
        (source) =>
          (category === "all" || source.category === category) &&
          (role === "all" || source.role === role) &&
          `${source.label} ${coverageDescription(source.coverage)} ${source.category}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [data, query, category, role],
  );
  const selected = data?.sources.find((source) => source.id === selectedId);

  function openSource(source: Source) {
    setSelectedId(source.id);
    setShowImport(false);
    setMessage("");
    setCustomMode(false);
    setSourceUrl("");
    setBody("");
    if (window.innerWidth < 1280)
      requestAnimationFrame(() =>
        document
          .getElementById("source-playbook")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  }

  async function loadReviewQueue() {
    if (!session.authenticated) {
      session.requestUnlock();
      setMessage("Unlock the private workspace to inspect reviewed evidence.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        "/api/source-network/intake?includeContent=true",
        { credentials: "same-origin", cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load evidence");
      setReviewItems(result.items);
      setMessage("");
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not load evidence",
      );
    } finally {
      setBusy(false);
    }
  }

  async function operate(action: string, payload: unknown) {
    if (!session.authenticated) {
      session.requestUnlock();
      setMessage(
        "Unlock the private workspace to save evidence or run collection.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/source-network/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          [
            result.error,
            ...(Array.isArray(result.details) ? result.details : []),
          ].join(" · "),
        );
      setMessage(
        result.message ||
          (result.job?.id
            ? `Collection job ${result.job.id} started. Follow every handoff in Activity.`
            : "Collection started. This page will refresh while it runs."),
      );
      if (action === "run") await refresh();
      if (action === "intake") setBody("");
      if (action === "review") {
        await loadReviewQueue();
        setMessage(
          "Evidence review saved. Property facts still require source verification.",
        );
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage("Choose an evidence file under 512 KB.");
      return;
    }
    setKind(
      file.name.endsWith(".json")
        ? "json"
        : file.name.endsWith(".csv")
          ? "csv"
          : "text",
    );
    setBody(await file.text());
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper text-ink outline-none">
      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-10">
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Source coverage
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink-2">
              Review collection results, recent changes, and sources that still need a manual check.
            </p>
          </div>
          <div className="rounded-card border border-line bg-card p-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                [data?.summary.catalogSources, "Source workflows"],
                [data?.summary.automatedCollectors, "Collectors registered"],
                // What is actually in the store, not the observation index.
                // trackedRecords counts every record ever observed, including
                // ones the store no longer holds - live it read 11,080 against
                // a store of 9,831, on a page whose job is answering "how much
                // inventory do we have".
                [data?.summary.storedRecords ?? data?.summary.trackedRecords, "Records in store"],
              ].map(([value, text]) => (
                <div key={String(text)}>
                  <p className="text-2xl font-semibold tabular-nums">
                    {typeof value === "number" ? value.toLocaleString() : "—"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-ink-2">
                    {text}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-3" role="status" aria-label="Collection worker status">
              <p className={`text-xs font-semibold ${data?.collectionHealth?.degraded ? "text-catch-ink" : "text-ink-2"}`}>
                Collection worker: {data?.collectionHealth?.status === "healthy" ? "Healthy" : data?.collectionHealth?.status === "stale" ? "Needs attention" : data?.collectionHealth?.status === "disabled" ? "Disabled" : "Not started"}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-3">
                {data?.collectionHealth?.status === "healthy" ? `Last check ${date(data.collectionHealth.lastSeenAt)}${data.collectionHealth.backlog.queued ? ` · ${data.collectionHealth.backlog.queued} queued` : ""}` : data?.collectionHealth?.status === "stale" ? `Automation has not checked in recently. ${data.collectionHealth.backlog.queued} queued job${data.collectionHealth.backlog.queued === 1 ? "" : "s"}.` : "Database availability is reported separately from collection automation."}
              </p>
            </div>
            <p className="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-3">
              A registered collector is not proof of complete coverage. Review each source’s latest result below.
            </p>
          </div>
        </div>

        <section
          className="mt-6 rounded-card border border-line bg-card p-5 sm:p-7"
          aria-labelledby="changes-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-ink-2">
                Source collection changes
              </p>
              <h2 id="changes-heading" className="mt-1 text-xl font-semibold">
                What changed in collected records
              </h2>
            </div>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="flex items-center gap-2 rounded-control border border-line px-4 py-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />{" "}
              Refresh
            </button>
          </div>
          {data?.historyUnavailable ? (
            <p
              role="alert"
              className="mt-5 rounded-control bg-catch-wash text-catch-ink p-4 text-sm"
            >
              Collection history could not be read. Source workflows remain
              available; an operator needs to restore the observation store.
            </p>
          ) : data?.signals.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {data.signals.slice(0, 6).map((signal) => (
                <article
                  key={signal.id}
                  className="rounded-control bg-paper p-5"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink-2">
                    <ArrowDownRight size={18} />
                    {signal.title}
                  </div>
                  <Link
                    className="mt-2 block font-medium hover:underline"
                    href={`/listings/${encodeURIComponent(signal.listingId)}?returnTo=${encodeURIComponent("/sources")}`}
                  >
                    {signal.address}
                  </Link>
                  <p className="mt-3 text-sm">
                    <span className="text-ink-2">
                      {moneyOrText(signal, signal.before)}
                    </span>
                    <span className="mx-2">→</span>
                    <strong>{moneyOrText(signal, signal.after)}</strong>
                  </p>
                  <p className="mt-2 text-xs text-ink-2">
                    Observed {date(signal.observedAt)}
                  </p>
                  <a
                    href={signal.evidence[1]?.sourceUrl || signal.evidence[0]?.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold underline"
                  >
                    Check current publisher record <ExternalLink size={12} />
                  </a>
                </article>
              ))}
            </div>
          ) : (
            /* min-h-screen, same reason as the results grid on /listings: this
                explainer is about 240px of section, and the six-card signal
                grid that replaces it is about 700px. Everything below this
                section was inside the viewport in the small state and far
                outside it in the large one, which measured as CLS 0.30 --
                the SourceAtlas, the coverage matrix and the footer all left
                the screen the moment collection history answered.

                Reserving a viewport on the pre-data state keeps everything
                below the fold for the whole load. The loaded state keeps its
                natural height, so nothing moves that a user could see. */
            <div className="mt-5 flex min-h-screen items-start gap-4 rounded-control bg-paper p-5">
              <Radar className="mt-1 shrink-0 text-ink" size={25} />
              <div>
                <p className="font-medium">Building the observation history</p>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">
                  Collect a source twice to compare published bids, sale dates,
                  payment terms, and status. The first collection establishes a
                  baseline. Changes will appear here with their before-and-after
                  evidence.
                </p>
              </div>
            </div>
          )}
        </section>

        <SourceAtlas atlas={data?.atlas} storageMode={data?.storageMode} />

        <section className="mt-9" aria-labelledby="coverage-matrix-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="coverage-matrix-heading" className="text-xl font-semibold">
                Per-county coverage matrix
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                Known record-type coverage per source. A dash means the dimension is not claimed; "Not mapped" means no coverage data exists for that source yet.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {session.authenticated && (
                <>
                  <span className="rounded-control border border-line bg-card px-3 py-2 text-xs text-ink-2">
                    Onboarding: <strong>{onboardingItems ? `${onboardingItems.length} probed` : "Loading…"}</strong>
                  </span>
                  <span className="rounded-control border border-line bg-card px-3 py-2 text-xs text-ink-2">
                    Unbrowse: <strong>{unbrowseStatus ? (unbrowseStatus.installed ? "Installed" : "Not installed") : "Checking…"}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selected) {
                        if (!unbrowseSourceId) setUnbrowseSourceId(selected.id);
                        if (!unbrowseSourceUrl) setUnbrowseSourceUrl(selected.discoveryUrl);
                      }
                      setShowUnbrowseIntake((v) => !v);
                    }}
                    className="rounded-control border border-line bg-card px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
                  >
                    {showUnbrowseIntake ? "Hide Unbrowse intake" : "Unbrowse route intake"}
                  </button>
                </>
              )}
              <button
                onClick={() => setShowCoverageMatrix((v) => !v)}
                aria-expanded={showCoverageMatrix}
                aria-controls="coverage-matrix-table"
                className="rounded-control border border-line bg-card px-4 py-2 text-sm font-semibold"
              >
                {showCoverageMatrix ? "Hide coverage matrix" : "Show coverage matrix"}
              </button>
            </div>
          </div>
          {activeJob && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-yours/30 bg-yours-wash px-4 py-3 text-xs text-ink">
              <span>
                <strong>Collection Job {activeJob.id}</strong> ({activeJob.sourceId || "source"}) — status: <strong>{activeJob.status || "running"}</strong>
                {typeof activeJob.acceptedCount === "number" ? ` · ${activeJob.acceptedCount} accepted` : ""}
              </span>
              {activeJob.error ? <span className="text-catch-ink">{activeJob.error}</span> : null}
            </div>
          )}
          {session.authenticated && showUnbrowseIntake && (
            <form
              onSubmit={(event) => void submitUnbrowseCandidate(event)}
              className="mb-5 grid gap-3 rounded-card border border-line bg-card p-5 sm:grid-cols-2"
            >
              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-ink">Unbrowse Route Candidate Intake</h3>
                  <p className="text-xs text-ink-2">
                    Submit an inspected GET endpoint candidate (`property-crawl.unbrowse-route-candidate/v1`) to the source review queue.
                  </p>
                </div>
              </div>
              <label className="block text-xs">
                <span className="font-medium text-ink-2">Source ID</span>
                <input
                  required
                  value={unbrowseSourceId}
                  onChange={(e) => setUnbrowseSourceId(e.target.value)}
                  placeholder={selected?.id || "e.g. irs"}
                  className="mt-1 w-full rounded-control border border-line px-3 py-2 text-xs outline-none"
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-ink-2">Unbrowse Version</span>
                <input
                  required
                  value={unbrowseVersion}
                  onChange={(e) => setUnbrowseVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="mt-1 w-full rounded-control border border-line px-3 py-2 text-xs outline-none"
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-ink-2">Publisher Source URL (HTTPS)</span>
                <input
                  required
                  type="url"
                  value={unbrowseSourceUrl}
                  onChange={(e) => setUnbrowseSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-control border border-line px-3 py-2 text-xs outline-none"
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-ink-2">Observed JSON/API Endpoint URL (HTTPS)</span>
                <input
                  required
                  type="url"
                  value={unbrowseEndpointUrl}
                  onChange={(e) => setUnbrowseEndpointUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-control border border-line px-3 py-2 text-xs outline-none"
                />
              </label>
              <label className="block text-xs sm:col-span-2">
                <span className="font-medium text-ink-2">Notes (optional)</span>
                <input
                  value={unbrowseNotes}
                  onChange={(e) => setUnbrowseNotes(e.target.value)}
                  placeholder="Observed public GET endpoint metadata (no credentials)"
                  className="mt-1 w-full rounded-control border border-line px-3 py-2 text-xs outline-none"
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-control bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Submitting…" : "Submit Unbrowse candidate"}
                </button>
              </div>
            </form>
          )}
          {showCoverageMatrix && (
            <div
              id="coverage-matrix-table"
              className="overflow-x-auto rounded-card border border-line bg-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/70 px-4 py-3 text-xs text-ink-2">
                <div>
                  <span className="font-semibold text-ink">Live state coverage matrix:</span>{" "}
                  {liveCoverage?.liveByState ? `${liveCoverage.liveByState.countedRecords ?? 0} live records across ${Object.keys(liveCoverage.liveByState.byStateTotal || {}).length} active states (${Object.values(liveCoverage.liveByState.byCounty || {}).reduce((acc, rows) => acc + rows.length, 0)} live counties; ${liveCoverage.states?.length ?? 0} schema jurisdictions)${liveCoverage.liveByState.readError ? ` — Store error: ${liveCoverage.liveByState.readError}` : ""}` : liveCoverage?.states
                    ? `${liveCoverage.states.length} states tracked in live/catalog matrix`
                    : "Loading state coverage summary…"}
                </div>
                {session.authenticated && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      <strong>Onboarding cache:</strong>{" "}
                      {onboardingItems ? `${onboardingItems.length} probed` : "—"}
                    </span>
                    <span>
                      <strong>Unbrowse probe:</strong>{" "}
                      {unbrowseStatus
                        ? unbrowseStatus.installed
                          ? "Installed"
                          : "Not installed"
                        : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void runOnboardingPass()}
                      disabled={runningOnboarding}
                      className="rounded-control border border-line-strong bg-card px-2.5 py-1 font-semibold text-ink hover:bg-paper disabled:opacity-50"
                    >
                      {runningOnboarding ? "Probing…" : "Run onboarding pass"}
                    </button>
                  </div>
                )}
              </div>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper">
                    <th className="px-4 py-3 font-semibold">Source</th>
                    {COVERAGE_DIMENSIONS.map((dim) => (
                      <th
                        key={dim}
                        className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-2"
                      >
                        {COVERAGE_DIMENSION_LABELS[dim]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.sources || []).map((source) => {
                    const preset = coveragePresetFor(source);
                    const liveStats = liveCoverageForSource(source, liveCoverage);
                    const derived = serverDerivedCoverage(source, preset, liveStats);
                    return (
                      <tr
                        key={source.id}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{source.label}</span>
                            {preset ? (
                              <span
                                className="rounded-full bg-paper px-2 py-0.5 text-label font-semibold text-ink-2"
                                title={preset.countyLabel}
                              >
                                {preset.countyCount > 0
                                  ? `${preset.countyCount} catalog counties${liveStats ? ` · ${liveStats.countyCount > 0 ? `${liveStats.countyCount} live counties` : liveStats.recordCount > 0 ? `${liveStats.stateCount} live states` : "0 live records"} (${liveStats.recordCount.toLocaleString()} records)` : ""}`
                                  : `${preset.countyLabel}${liveStats ? ` · ${liveStats.recordCount > 0 ? `${liveStats.countyCount > 0 ? `${liveStats.countyCount} live counties · ` : ""}${liveStats.stateCount} live states (${liveStats.recordCount.toLocaleString()} records)` : "0 live records"}` : ""}`}
                              </span>
                            ) : (
                              <span
                                className="rounded-full bg-paper px-2 py-0.5 text-label font-semibold text-ink-3"
                                title={derived.label}
                              >
                                {liveStats && liveStats.recordCount > 0
                                  ? `${liveStats.countyCount > 0 ? `${liveStats.countyCount} live counties · ` : ""}${liveStats.stateCount} live states (${liveStats.recordCount.toLocaleString()} records)`
                                  : derived.hasMapping
                                    ? derived.label
                                    : liveStats
                                      ? "Not mapped · 0 live records"
                                      : "Not mapped"}
                              </span>
                            )}
                          </div>
                        </td>
                        {COVERAGE_DIMENSIONS.map((dim) => {
                          if (!derived.hasMapping) {
                            return (
                              <td
                                key={dim}
                                className="px-3 py-3 text-center text-ink-3"
                                aria-label="Not mapped"
                              >
                                —
                              </td>
                            );
                          }
                          const covered = derived.dimensions[dim] === true;
                          return (
                            <td
                              key={dim}
                              className="px-3 py-3 text-center"
                              aria-label={
                                covered
                                  ? `${COVERAGE_DIMENSION_LABELS[dim]} covered`
                                  : `${COVERAGE_DIMENSION_LABELS[dim]} not covered`
                              }
                            >
                              {covered ? (
                                <Check
                                  size={16}
                                  className="mx-auto text-ink-2"
                                />
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {!data?.sources?.length && (
                    <tr>
                      <td
                        colSpan={COVERAGE_DIMENSIONS.length + 1}
                        className="px-4 py-6 text-center text-sm text-ink-3"
                      >
                        No sources loaded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-9" aria-labelledby="network-heading">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="network-heading" className="text-2xl font-semibold">
                Explore the network
              </h2>
              {data?.sources?.length ? (
                <p className="mt-1 text-sm text-ink-2" role="status" aria-label="Source status summary">
                  {taxonomySummary(data.sources)}
                </p>
              ) : null}
            </div>
            <button
              onClick={() => {
                setCustomMode(true);
                setSelectedId(null);
                setShowImport(true);
                setMessage("");
                setBody("");
                setSourceUrl("");
                setCapturedAt(new Date().toISOString());
                requestAnimationFrame(() =>
                  document
                    .getElementById("source-playbook")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
              className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white"
            >
              <FilePlus2 size={16} /> Add a local source
            </button>
          </div>
          <div className="mb-6 flex flex-col gap-3 md:flex-row">
            <label className="flex flex-1 items-center gap-3 rounded-control border border-line bg-card px-4">
              <Search size={17} className="text-ink-2" />
              <input
                aria-label="Search sources"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sources, regions, or record types"
                className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
              />
            </label>
            <select
              aria-label="Source category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-control border border-line bg-card px-4 py-3 text-sm"
            >
              <option value="all">All source categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <select
              aria-label="Source role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-control border border-line bg-card px-4 py-3 text-sm"
            >
              <option value="all">All record types</option>
              <option value="opportunity">Property opportunities</option>
              <option value="evidence">Supporting evidence</option>
              <option value="discovery">Source directories</option>
            </select>
          </div>
          {error && (
            <p
              role="alert"
              className="mb-5 rounded-control bg-catch-wash text-catch-ink p-4 text-sm text-catch-ink"
            >
              {error} Use Refresh to retry.
            </p>
          )}
          {data?.evidenceQueueError && (
            <p
              role="alert"
              className="mb-5 rounded-control bg-catch-wash text-catch-ink p-4 text-sm text-catch-ink"
            >
              The evidence queue could not be read. Catalog workflows are
              available; packet counts and enrolled local sources are
              temporarily unavailable.
            </p>
          )}
          {data?.inventoryTruncated && (
            <p className="mb-4 text-sm text-catch-ink">
              Inventory counts cover the first 10,000 records. Source workflows
              remain fully listed.
            </p>
          )}
          {data?.observationStore && (
            <p className="mb-4 text-sm text-ink-2">
              Observation history: {data.observationStore.rows.toLocaleString()} snapshots
              across {data.observationStore.trackedRecords.toLocaleString()} publisher
              records in Postgres
              {data.observationStore.newestObservedAt
                ? `, newest observed ${new Date(data.observationStore.newestObservedAt).toLocaleString()}`
                : ""}
              {" "}({Math.max(1, Math.round(data.observationStore.tableBytes / (1024 * 1024)))} MB).
              History is durable — there is no file ceiling it can overflow.
            </p>
          )}
          {data?.observationStore?.newestObservedAt && (
            (() => {
              const ageDays = (Date.now() - Date.parse(data.observationStore.newestObservedAt)) / 86_400_000;
              if (ageDays <= 3) return null;
              return (
                <p className={`mb-4 rounded-control p-3 text-sm ${ageDays > 14 ? "border border-catch/40 bg-catch-wash text-catch-ink font-semibold" : "bg-catch-wash text-catch-ink text-catch-ink"}`}>
                  No observation has been recorded in {Math.floor(ageDays)} days. Collection may be
                  stopped — the "collected" verdicts below are only as current as that last observation.
                </p>
              );
            })()
          )}
          {loading && !data ? (
            <p className="flex items-center gap-2 py-12">
              <Loader2 size={18} className="animate-spin" /> Loading source
              coverage…
            </p>
          ) : (
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[1fr_420px]">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {sources.map((source) => {
                  const exactScope = coverageScopeDetails(source.coverage);
                  const status = sourceStatus(source);
                  const problem = collectionProblem(source);
                  return (
                    <article
                      key={source.id}
                      className={`min-w-0 overflow-hidden rounded-control border transition-colors ${selectedId === source.id ? "border-ink bg-paper" : "border-line bg-card hover:border-ink"}`}
                    >
                      <button
                        onClick={() => openSource(source)}
                        aria-pressed={selectedId === source.id}
                        className="w-full min-w-0 p-4 text-left sm:p-5"
                      >
                        <p className="text-label font-bold uppercase tracking-[0.12em] text-ink-2">
                          {label(source.category)}
                        </p>
                        <h3 className="mt-2 break-words text-base font-semibold">
                          {source.label}
                        </h3>
                        <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-ink-2">
                          {coverageDescription(source.coverage)}
                        </p>
                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded px-2 py-1 text-label font-semibold ${status.color}`}
                            >
                              {status.label}
                            </span>
                            {taxonomyBadge(source.trustStatus) ? (
                              <span
                                title={taxonomyBadge(source.trustStatus)!.description}
                                className={`rounded px-2 py-1 text-label font-semibold ${taxonomyBadge(source.trustStatus)!.color}`}
                              >
                                {taxonomyBadge(source.trustStatus)!.label}
                              </span>
                            ) : null}
                          </div>
                          <ArrowRight size={16} />
                        </div>
                        {problem ? (
                          <p className="mt-3 text-xs leading-5 text-catch-ink">
                            {problem}
                          </p>
                        ) : (
                          <p className="mt-3 text-xs leading-5 text-ink-2">
                            {coverageSummary(source)}
                          </p>
                        )}
                      </button>
                      {exactScope && (
                        <details className="border-t border-line px-5 pb-4 text-xs leading-5 text-ink-2">
                          <summary
                            aria-label={`Inspect exact recorded scope for ${source.label}`}
                            className="cursor-pointer pt-3 font-medium text-ink"
                          >
                            Exact recorded scope
                          </summary>
                          <p className="mt-1 break-words">{exactScope}</p>
                        </details>
                      )}
                    </article>
                  );
                })}
                {!sources.length && !error && (
                  <p className="p-5 text-sm text-ink-2">
                    No sources match these filters.
                  </p>
                )}
              </div>
              <aside
                id="source-playbook"
                className="min-w-0 scroll-mt-5 rounded-card border border-line bg-card p-6 xl:sticky xl:top-6"
              >
                {selected || customMode ? (
                  <>
                    <p className="text-xs font-bold uppercase tracking-widest text-ink-2">
                      {customMode
                        ? "Extend your coverage"
                        : "The collection playbook"}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold">
                      {customMode ? "Bring in a local source" : selected?.label}
                    </h2>
                    {selected && (
                      <>
                        <p className="mt-3 text-sm leading-6 text-ink-2">
                          {selected.workflow.primary}
                        </p>
                        <a
                          href={selected.discoveryUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-ink underline hover:text-ink-2"
                        >
                          Open publisher <ExternalLink size={14} />
                        </a>
                        <ol className="mt-6 space-y-4">
                          {selected.workflow.steps.map((step, index) => (
                            <li
                              key={step}
                              className="flex gap-3 text-sm leading-6"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-bold">
                                {index + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <div className="mt-6 border-t border-line pt-5">
                          <h3 className="text-xs font-bold uppercase tracking-wider">
                            Evidence to bring back
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {selected.requiredEvidence.map((item) => (
                              <li
                                key={item}
                                className="flex gap-2 text-xs leading-5 text-ink-2"
                              >
                                <Check
                                  size={14}
                                  className="mt-0.5 shrink-0 text-ink-2"
                                />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="mt-5 rounded-control bg-paper p-4 text-xs leading-5">
                          <p className="font-semibold">
                            If the collector cannot reach it
                          </p>
                          <p className="mt-1 text-ink-2">
                            {selected.workflow.fallback}
                          </p>
                        </div>
                        <p className="mt-4 text-xs leading-5 text-ink-2">
                          Suggested check: every{" "}
                          {selected.workflow.cadenceHours} hours. Last
                          collection:{" "}
                          {date(selected.lastRun?.lastRunAt || null)}.
                        </p>
                        {collectionProblem(selected) && (
                          <p role="alert" className="mt-2 rounded-control bg-catch-wash p-3 text-xs leading-5 text-catch-ink">
                            {collectionProblem(selected)}{releaseGateMessage(selected) ? "" : " Follow the fallback workflow or retry."}
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                          {selected.propertyLookup && (
                            <Link
                              href="/listings"
                              className="rounded-control bg-ink px-4 py-2.5 text-xs font-semibold text-white"
                            >
                              Choose a property to investigate
                            </Link>
                          )}
                          {selected.automated && (
                            <button
                              onClick={() =>
                                void collectSource(selected.id)
                              }
                              disabled={busy || data?.collectionRunning}
                              className="rounded-control bg-ink px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {data?.collectionRunning
                                ? "Collection running…"
                                : "Collect this source"}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setShowImport(!showImport);
                              setCapturedAt(new Date().toISOString());
                            }}
                            className="rounded-control border border-line px-4 py-2.5 text-xs font-semibold"
                          >
                            Import evidence
                          </button>
                        </div>
                      </>
                    )}
                    {showImport && (
                      <form
                        className="mt-6 space-y-4 border-t border-line pt-5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void operate("intake", {
                            sourceId: customMode ? customId : selected?.id,
                            sourceUrl,
                            capturedAt,
                            kind,
                            body,
                            ...(customMode
                              ? {
                                  customSource: {
                                    name: customName,
                                    organization: customOrganization,
                                    homepageUrl: customHomepage,
                                  },
                                }
                              : selected?.category === "local_source"
                                ? {
                                    customSource: {
                                      name: selected.label,
                                      organization: selected.organization,
                                      homepageUrl: selected.discoveryUrl,
                                    },
                                  }
                                : {}),
                          });
                        }}
                      >
                        {customMode && (
                          <>
                            <p className="text-sm leading-6 text-ink-2">
                              Capture a county, land-bank, agency, or local
                              publisher record. It will enter the evidence
                              review queue with its source attached.
                            </p>
                            <Field
                              title="Source name"
                              value={customName}
                              onChange={setCustomName}
                              placeholder="County tax auction office"
                            />
                            <Field
                              title="Publisher organization"
                              value={customOrganization}
                              onChange={setCustomOrganization}
                              placeholder="County Treasurer’s Office"
                            />
                            <Field
                              title="Source identifier"
                              value={customId}
                              onChange={setCustomId}
                              placeholder="county-tax-auctions"
                            />
                            <Field
                              title="Publisher homepage"
                              value={customHomepage}
                              onChange={setCustomHomepage}
                              placeholder="https://…"
                            />
                          </>
                        )}
                        <Field
                          title="Exact record URL"
                          value={sourceUrl}
                          onChange={setSourceUrl}
                          placeholder="https://…/property-or-notice"
                        />
                        <Field
                          title="When you captured the record (ISO timestamp)"
                          value={capturedAt}
                          onChange={setCapturedAt}
                          placeholder="2026-09-05T18:00:00Z"
                        />
                        <label className="block text-xs font-semibold">
                          Evidence format
                          <select
                            value={kind}
                            onChange={(event) => setKind(event.target.value)}
                            className="mt-2 w-full rounded-control border border-line bg-card p-2.5 font-normal"
                          >
                            <option value="text">Notice text</option>
                            <option value="csv">CSV export</option>
                            <option value="json">JSON records</option>
                          </select>
                        </label>
                        <label className="block text-xs font-semibold">
                          Load a text, CSV, or JSON file
                          <input
                            type="file"
                            accept=".txt,.csv,.json"
                            className="mt-2 block w-full text-xs font-normal"
                            onChange={(event) =>
                              void readFile(event.target.files?.[0])
                            }
                          />
                        </label>
                        <label className="block text-xs font-semibold">
                          Evidence content
                          <textarea
                            required
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            rows={6}
                            placeholder="Paste the source notice or exported records."
                            className="mt-2 w-full rounded-control border border-line p-3 font-normal"
                          />
                        </label>
                        <button
                          disabled={busy}
                          className="w-full rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save for evidence review"}
                        </button>
                        <p className="text-xs leading-5 text-ink-2">
                          Imported records are kept as evidence until reviewed.
                          This does not establish title, value, or sale
                          availability.
                        </p>
                      </form>
                    )}
                    <div className="mt-6 border-t border-line pt-4">
                      <p className="text-xs font-semibold">
                        Private operator access
                      </p>
                      <p className="mt-2 text-xs leading-5 text-ink-2">
                        The shared eight-hour workspace session protects
                        collection and reviewed evidence. Credentials are
                        forwarded only between the application servers.
                      </p>
                      <div className="mt-3 flex gap-2">
                        {session.authenticated ? (
                          <button
                            onClick={() => void loadReviewQueue()}
                            disabled={busy}
                            className="rounded-control border border-line px-3 py-2 text-xs font-semibold disabled:opacity-50"
                          >
                            Open evidence review queue
                          </button>
                        ) : (
                          <button
                            onClick={session.requestUnlock}
                            className="rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white"
                          >
                            Unlock workspace
                          </button>
                        )}
                        <Link
                          href="/activity"
                          className="rounded-control border border-line px-3 py-2 text-xs font-semibold"
                        >
                          View activity
                        </Link>
                      </div>
                    </div>
                    {reviewItems && (
                      <div className="mt-5 space-y-3">
                        <h3 className="text-sm font-semibold">
                          Evidence review queue
                        </h3>
                        {!reviewItems.length && (
                          <p className="text-xs text-ink-2">
                            No evidence packets submitted yet.
                          </p>
                        )}
                        {reviewItems.map((item) => (
                          <article
                            key={item.id}
                            className="rounded-control border border-line p-3"
                          >
                            <p className="break-all text-xs font-semibold">
                              {sourceDisplayText(item.sourceId)} ·{" "}
                              {item.review?.decision || "Needs review"}
                            </p>
                            {item.sourceUrl ? (
                              <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block text-xs text-ink underline hover:text-ink-2"
                            >
                              Open source record
                            </a>
                            ) : null}
                            <p className="mt-2 text-xs text-ink-2">
                              Captured {date(item.capturedAt)}
                            </p>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs">
                                Inspect submitted evidence
                              </summary>
                              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-paper p-2 text-label">
                                {sourceDisplayText(
                                  JSON.stringify(item.original, null, 2),
                                )}
                              </pre>
                            </details>
                            {item.status === "needs_review" && (
                              <div className="mt-3 flex gap-2">
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void operate("review", {
                                      id: item.id,
                                      decision: "approve",
                                      note: "Evidence packet reviewed in Source Radar; listing and title facts require separate verification.",
                                    })
                                  }
                                  className="rounded border border-line px-2 py-1 text-xs"
                                >
                                  Accept evidence
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void operate("review", {
                                      id: item.id,
                                      decision: "reject",
                                    })
                                  }
                                  className="rounded border border-line px-2 py-1 text-xs"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                    {message && (
                      <p
                        role="status"
                        className="mt-4 rounded-control bg-paper p-4 text-xs leading-6"
                      >
                        {message}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="py-8">
                    <ShieldCheck size={32} className="text-ink" />
                    <h3 className="mt-5 text-xl font-semibold">
                      Every find needs a trail.
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-ink-2">
                      Choose a source to see its workflow, publisher link,
                      collection status, and the evidence you need to bring
                      back.
                    </p>
                    <p className="mt-5 border-t border-line pt-5 text-xs leading-6 text-ink-2">
                      A registered collector indicates a collection path. Review
                      its observed records and latest run to assess actual
                      coverage.
                    </p>
                  </div>
                )}
              </aside>
            </div>
          )}
        </section>
        <footer className="mt-10 border-t border-line py-6 text-xs leading-6 text-ink-2">
          Source Radar · Publisher evidence, observed changes, and a next step
          for every source.{" "}
          <Link
            href="/listings"
            className="ml-2 font-semibold text-ink underline hover:text-ink-2"
          >
            Return to properties
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Field({
  title,
  value,
  onChange,
  placeholder,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold">
      {title}
      <input
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-control border border-line p-2.5 font-normal"
      />
    </label>
  );
}
