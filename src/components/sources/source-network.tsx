"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { sourceDisplayText } from "@/lib/source-display";
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

type Source = {
  id: string;
  label: string;
  category: string;
  role: string;
  coverage: string;
  organization?: string;
  propertyLookup?: boolean;
  discoveryUrl: string;
  access: string;
  adapterKey: string | null;
  discoveryStatus?: string;
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
  inventoryTruncated: boolean;
  evidenceQueueError: boolean;
  historyUnavailable: boolean;
  summary: {
    catalogSources: number;
    automatedCollectors: number;
    collected: number;
    needsAttention: number;
    importSources: number;
    observedRecords: number;
    trackedRecords: number;
  };
  atlas?: SourceAtlasData;
  storageMode?: string;
};
const STATUS: Record<string, { label: string; color: string }> = {
  lookup_available: {
    label: "Property lookup",
    color: "bg-slate-100 text-slate-900",
  },
  collected: {
    label: "Recently collected",
    color: "bg-emerald-100 text-emerald-900",
  },
  awaiting_run: {
    label: "Ready to collect",
    color: "bg-slate-100 text-slate-900",
  },
  import_available: {
    label: "Evidence import",
    color: "bg-stone-100 text-stone-600",
  },
  attention: {
    label: "Collection needs attention",
    color: "bg-amber-100 text-amber-900",
  },
  stale: { label: "Refresh due", color: "bg-amber-100 text-amber-900" },
  empty: { label: "No records returned", color: "bg-stone-100 text-stone-600" },
  evidence_queued: {
    label: "Notices in review queue",
    color: "bg-slate-100 text-slate-900",
  },
  history_unavailable: {
    label: "History unavailable",
    color: "bg-amber-100 text-amber-900",
  },
};
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/source-network", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load source coverage");
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
          `${source.label} ${source.coverage} ${source.category}`
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
    <main className="min-h-screen bg-[#f5f5f0] text-[#182c29]">
      <div className="mx-auto max-w-[1440px] px-5 py-10 sm:px-10">
        <div className="grid gap-7 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
              <Radar size={17} /> Follow the paper trail
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              The overlooked starts
              <br />
              at the source.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#6B7280]">
              Government notices. County sales. Lender inventory. One place to
              follow the sources, capture the evidence, and see what changed.
            </p>
          </div>
          <div className="rounded-2xl bg-[#0F172A] p-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Your research network
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                [data?.summary.catalogSources, "Source workflows"],
                [data?.summary.automatedCollectors, "Collectors registered"],
                [data?.summary.trackedRecords, "Records tracked"],
              ].map(([value, text]) => (
                <div key={String(text)}>
                  <p className="text-3xl font-semibold tabular-nums">
                    {value ?? "—"}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-200/80">
                    {text}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-white/15 pt-4 text-xs leading-5 text-slate-200/70">
              Coverage is measured by collected evidence. Every source has a
              next step, including those that need an import or local access.
            </p>
          </div>
        </div>

        <SourceAtlas atlas={data?.atlas} storageMode={data?.storageMode} />
        <section
          className="mt-10 rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"
          aria-labelledby="changes-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
                The second look
              </p>
              <h2 id="changes-heading" className="mt-1 text-xl font-semibold">
                What changed since we last looked
              </h2>
            </div>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />{" "}
              Refresh
            </button>
          </div>
          {data?.historyUnavailable ? (
            <p
              role="alert"
              className="mt-5 rounded-lg bg-amber-100 p-4 text-sm"
            >
              Collection history could not be read. Source workflows remain
              available; an operator needs to restore the observation store.
            </p>
          ) : data?.signals.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {data.signals.slice(0, 6).map((signal) => (
                <article
                  key={signal.id}
                  className="rounded-xl bg-[#F1F5F9] p-5"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
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
                    <span className="text-[#6B7280]">
                      {moneyOrText(signal, signal.before)}
                    </span>
                    <span className="mx-2">→</span>
                    <strong>{moneyOrText(signal, signal.after)}</strong>
                  </p>
                  <p className="mt-2 text-xs text-[#6B7280]">
                    Observed {date(signal.observedAt)}
                  </p>
                  <a
                    href={signal.evidence[1]?.sourceUrl}
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
            <div className="mt-5 flex items-start gap-4 rounded-xl bg-[#F5F6F7] p-5">
              <Radar className="mt-1 shrink-0 text-slate-900" size={25} />
              <div>
                <p className="font-medium">Building the observation history</p>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6B7280]">
                  Collect a source twice to compare published bids, sale dates,
                  payment terms, and status. The first collection establishes a
                  baseline. Changes will appear here with their before-and-after
                  evidence.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="mt-9" aria-labelledby="network-heading">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="network-heading" className="text-2xl font-semibold">
              Explore the network
            </h2>
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
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white"
            >
              <FilePlus2 size={16} /> Add a local source
            </button>
          </div>
          <div className="mb-6 flex flex-col gap-3 md:flex-row">
            <label className="flex flex-1 items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white px-4">
              <Search size={17} className="text-[#6B7280]" />
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
              className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm"
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
              className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm"
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
              className="mb-5 rounded-lg bg-amber-100 p-4 text-sm text-amber-950"
            >
              {error} Use Refresh to retry.
            </p>
          )}
          {data?.evidenceQueueError && (
            <p
              role="alert"
              className="mb-5 rounded-lg bg-amber-100 p-4 text-sm text-amber-950"
            >
              The evidence queue could not be read. Catalog workflows are
              available; packet counts and enrolled local sources are
              temporarily unavailable.
            </p>
          )}
          {data?.inventoryTruncated && (
            <p className="mb-4 text-sm text-amber-800">
              Inventory counts cover the first 10,000 records. Source workflows
              remain fully listed.
            </p>
          )}
          {loading && !data ? (
            <p className="flex items-center gap-2 py-12">
              <Loader2 size={18} className="animate-spin" /> Loading source
              coverage…
            </p>
          ) : (
            <div className="grid items-start gap-6 xl:grid-cols-[1fr_420px]">
              <div className="grid gap-3 sm:grid-cols-2">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => openSource(source)}
                    aria-pressed={selectedId === source.id}
                    className={`rounded-xl border p-5 text-left transition-colors ${selectedId === source.id ? "border-slate-900 bg-slate-100" : "border-[#E5E7EB] bg-white hover:border-slate-900"}`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6B7280]">
                      {label(source.category)}
                    </p>
                    <h3 className="mt-2 text-base font-semibold">
                      {source.label}
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[#6B7280]">
                      {source.coverage}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span
                        className={`rounded px-2 py-1 text-[10px] font-semibold ${STATUS[source.discoveryStatus || source.status]?.color || "bg-stone-100 text-stone-600"}`}
                      >
                        {STATUS[source.discoveryStatus || source.status]?.label || label(source.discoveryStatus || source.status)}
                      </span>
                      <ArrowRight size={16} />
                    </div>
                    <p className="mt-3 text-xs text-[#6B7280]">
                      {source.observedRecords
                        ? `${source.observedRecords} observed records · ${source.observedStates.join(", ")}`
                        : source.evidencePackets
                          ? `${source.evidencePackets} evidence packets · review required`
                          : "Open workflow and evidence requirements"}
                    </p>
                  </button>
                ))}
                {!sources.length && !error && (
                  <p className="p-5 text-sm text-[#6B7280]">
                    No sources match these filters.
                  </p>
                )}
              </div>
              <aside
                id="source-playbook"
                className="scroll-mt-5 rounded-2xl border border-[#E5E7EB] bg-white p-6 xl:sticky xl:top-6"
              >
                {selected || customMode ? (
                  <>
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
                      {customMode
                        ? "Extend your coverage"
                        : "The collection playbook"}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold">
                      {customMode ? "Bring in a local source" : selected?.label}
                    </h2>
                    {selected && (
                      <>
                        <p className="mt-3 text-sm leading-6 text-[#6B7280]">
                          {selected.workflow.primary}
                        </p>
                        <a
                          href={selected.discoveryUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline hover:text-slate-700"
                        >
                          Open publisher <ExternalLink size={14} />
                        </a>
                        <ol className="mt-6 space-y-4">
                          {selected.workflow.steps.map((step, index) => (
                            <li
                              key={step}
                              className="flex gap-3 text-sm leading-6"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-bold">
                                {index + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <div className="mt-6 border-t border-[#E5E7EB] pt-5">
                          <h3 className="text-xs font-bold uppercase tracking-wider">
                            Evidence to bring back
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {selected.requiredEvidence.map((item) => (
                              <li
                                key={item}
                                className="flex gap-2 text-xs leading-5 text-[#6B7280]"
                              >
                                <Check
                                  size={14}
                                  className="mt-0.5 shrink-0 text-emerald-600"
                                />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="mt-5 rounded-lg bg-[#F5F6F7] p-4 text-xs leading-5">
                          <p className="font-semibold">
                            If the collector cannot reach it
                          </p>
                          <p className="mt-1 text-[#6B7280]">
                            {selected.workflow.fallback}
                          </p>
                        </div>
                        <p className="mt-4 text-xs leading-5 text-[#6B7280]">
                          Suggested check: every{" "}
                          {selected.workflow.cadenceHours} hours. Last
                          collection:{" "}
                          {date(selected.lastRun?.lastRunAt || null)}.
                        </p>
                        {selected.lastRun?.error && (
                          <p className="mt-2 text-xs text-amber-800">
                            Latest collection failed. Follow the fallback
                            workflow or retry.
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                          {selected.propertyLookup && (
                            <Link
                              href="/listings"
                              className="rounded-lg bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white"
                            >
                              Choose a property to investigate
                            </Link>
                          )}
                          {selected.automated && (
                            <button
                              onClick={() =>
                                void operate("run", { sourceId: selected.id })
                              }
                              disabled={busy || data?.collectionRunning}
                              className="rounded-lg bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
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
                            className="rounded-lg border border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold"
                          >
                            Import evidence
                          </button>
                        </div>
                      </>
                    )}
                    {showImport && (
                      <form
                        className="mt-6 space-y-4 border-t border-[#E5E7EB] pt-5"
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
                            <p className="text-sm leading-6 text-[#6B7280]">
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
                            className="mt-2 w-full rounded-lg border border-[#E5E7EB] bg-white p-2.5 font-normal"
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
                            className="mt-2 w-full rounded-lg border border-[#E5E7EB] p-3 font-normal"
                          />
                        </label>
                        <button
                          disabled={busy}
                          className="w-full rounded-lg bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save for evidence review"}
                        </button>
                        <p className="text-xs leading-5 text-[#6B7280]">
                          Imported records are kept as evidence until reviewed.
                          This does not establish title, value, or sale
                          availability.
                        </p>
                      </form>
                    )}
                    <div className="mt-6 border-t border-[#E5E7EB] pt-4">
                      <p className="text-xs font-semibold">
                        Private operator access
                      </p>
                      <p className="mt-2 text-xs leading-5 text-[#6B7280]">
                        The shared eight-hour workspace session protects
                        collection and reviewed evidence. Credentials are
                        forwarded only between the application servers.
                      </p>
                      <div className="mt-3 flex gap-2">
                        {session.authenticated ? (
                          <button
                            onClick={() => void loadReviewQueue()}
                            disabled={busy}
                            className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                          >
                            Open evidence review queue
                          </button>
                        ) : (
                          <button
                            onClick={session.requestUnlock}
                            className="rounded-lg bg-[#0F172A] px-3 py-2 text-xs font-semibold text-white"
                          >
                            Unlock workspace
                          </button>
                        )}
                        <Link
                          href="/activity"
                          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-semibold"
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
                          <p className="text-xs text-[#6B7280]">
                            No evidence packets submitted yet.
                          </p>
                        )}
                        {reviewItems.map((item) => (
                          <article
                            key={item.id}
                            className="rounded-lg border border-[#E5E7EB] p-3"
                          >
                            <p className="break-all text-xs font-semibold">
                              {sourceDisplayText(item.sourceId)} ·{" "}
                              {item.review?.decision || "Needs review"}
                            </p>
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block text-xs text-slate-900 underline hover:text-slate-700"
                            >
                              Open source record
                            </a>
                            <p className="mt-2 text-xs text-[#6B7280]">
                              Captured {date(item.capturedAt)}
                            </p>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs">
                                Inspect submitted evidence
                              </summary>
                              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-[#F5F6F7] p-2 text-[10px]">
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
                                  className="rounded border border-[#E5E7EB] px-2 py-1 text-xs"
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
                                  className="rounded border border-[#E5E7EB] px-2 py-1 text-xs"
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
                        className="mt-4 rounded-lg bg-[#F1F5F9] p-4 text-xs leading-6"
                      >
                        {message}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="py-8">
                    <ShieldCheck size={32} className="text-slate-900" />
                    <h3 className="mt-5 text-xl font-semibold">
                      Every find needs a trail.
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-[#6B7280]">
                      Choose a source to see its workflow, publisher link,
                      collection status, and the evidence you need to bring
                      back.
                    </p>
                    <p className="mt-5 border-t border-[#E5E7EB] pt-5 text-xs leading-6 text-[#6B7280]">
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
        <footer className="mt-10 border-t border-[#E5E7EB] py-6 text-xs leading-6 text-[#6B7280]">
          Source Radar · Publisher evidence, observed changes, and a next step
          for every source.{" "}
          <Link
            href="/listings"
            className="ml-2 font-semibold text-slate-900 underline hover:text-slate-700"
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
        className="mt-2 w-full rounded-lg border border-[#E5E7EB] p-2.5 font-normal"
      />
    </label>
  );
}
