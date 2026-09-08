"use client";

import Link from "next/link";
import { sourceDisplayText } from "@/lib/source-display";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Crosshair,
  ExternalLink,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { compileHuntQuery } from "@/lib/hunt-query";

type Rule = { field: string; operator: string; value?: string | number };
type Hunt = {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  criteria:
    | { mode: "all" | "any"; rules: Rule[]; discoveryFilters?: never }
    | { discoveryFilters: Record<string, string>; mode?: never; rules?: never };
};
type Clause = {
  field: string;
  operator: string;
  actual: unknown;
  expected?: unknown;
  status: string;
  reason: string;
  evidenceClass: string;
};
type Result = {
  listingId: string;
  address?: string;
  sourceId: string;
  sourceUrl: string;
  status: string;
  observedAt: string;
  clauseResults: Clause[];
};
type Event = {
  id: string;
  type: string;
  address?: string;
  listingId: string;
  observedAt: string;
  message: string;
  changedFields: string[];
};
type Evaluation = {
  evaluatedAt: string;
  baselineCreated: boolean;
  counts: Record<string, number>;
  results: Result[];
  resultsTruncated: boolean;
  newEvents: Event[];
  eventsTruncated: boolean;
};
const fields = [
  ["state", "State", "text"],
  ["source", "Source key", "text"],
  ["county", "County", "text"],
  ["propType", "Property type", "text"],
  ["status", "Published status", "text"],
  ["auctionProgram", "Publisher program", "text"],
  ["lifecycleStatus", "Publisher lifecycle", "text"],
  ["occupancy", "Occupancy / access", "text"],
  ["sourceObservedAt", "Observation time", "date"],
  ["openingBid", "Published opening bid", "number"],
  ["sqft", "Reported building area", "number"],
  ["saleDate", "Published sale date", "date"],
];
const operators: Record<string, [string, string][]> = {
  text: [
    ["eq", "is"],
    ["neq", "is not"],
    ["known", "is known"],
    ["unknown", "is unknown"],
  ],
  number: [
    ["lte", "at most"],
    ["gte", "at least"],
    ["eq", "equals"],
    ["known", "is known"],
    ["unknown", "is unknown"],
  ],
  date: [
    ["on_or_after", "on or after"],
    ["on_or_before", "on or before"],
    ["known", "is known"],
    ["unknown", "is unknown"],
  ],
};
const label = (value: string) =>
  fields.find(([field]) => field === value)?.[1] || value.replaceAll("_", " ");
const display = (value: unknown) =>
  value === null || value === undefined
    ? "Unknown"
    : typeof value === "object"
      ? sourceDisplayText(JSON.stringify(value))
      : sourceDisplayText(String(value));
const discoveryFilterLabels: Record<string, string> = {
  q: "Search", state: "State", county: "County", source: "Source", type: "Property type",
  program: "Program", lifecycle: "Lifecycle", saleFrom: "Sale from", saleTo: "Sale through",
  maxBid: "Maximum bid", minScore: "Minimum score", minEquity: "Minimum equity",
  occupancy: "Occupancy", freshness: "Freshness", hasDocuments: "Documents",
  seniorLien: "Senior lien", redemption: "Redemption",
};
const inputClass =
  "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm outline-slate-900";
const huntTemplates: {
  name: string;
  description: string;
  rules: () => Rule[];
}[] = [
  {
    name: "Published bid moved below my ceiling",
    description:
      "A new match appears when a supported opening amount falls to $150,000 or less.",
    rules: () => [{ field: "openingBid", operator: "lte", value: 150000 }],
  },
  {
    name: "Rescheduled sale",
    description:
      "Track records with a published date; later date changes appear as material events.",
    rules: () => [{ field: "saleDate", operator: "known" }],
  },
  {
    name: "Program and lifecycle review",
    description:
      "Keep publisher-program records whose lifecycle facts can be reviewed.",
    rules: () => [
      { field: "auctionProgram", operator: "known" },
      { field: "lifecycleStatus", operator: "known" },
    ],
  },
  {
    name: "Approaching published sale",
    description: "Find published deadlines within the next 14 days.",
    rules: () => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 14);
      return [
        {
          field: "saleDate",
          operator: "on_or_before",
          value: date.toISOString().slice(0, 10),
        },
      ];
    },
  },
  {
    name: "Building-area review",
    description:
      "Find records with an area to compare against parcel evidence in the case dossier.",
    rules: () => [{ field: "sqft", operator: "known" }],
  },
  {
    name: "Alachua Second Chance",
    description:
      "Draft the county and explicit public-availability criteria for reviewed records.",
    rules: () => [
      { field: "county", operator: "eq", value: "Alachua" },
      { field: "status", operator: "eq", value: "available_for_public" },
    ],
  },
];

export function SavedHunts() {
  const session = useWorkspaceSession();
  const [connected, setConnected] = useState(false);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [selected, setSelected] = useState<Hunt | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [inbox, setInbox] = useState<(Event & { huntName: string })[]>([]);
  const [name, setName] = useState("My overlooked-property hunt");
  const [mode, setMode] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<Rule[]>([
    { field: "state", operator: "eq", value: "FL" },
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("match");
  const [plainQuery, setPlainQuery] = useState(
    "Vacant land in Alachua County under $150k within 30 days",
  );
  const [missingDependencies, setMissingDependencies] = useState<string[]>([]);
  const selectedSectionRef = useRef<HTMLElement>(null);
  async function api(path = "", method = "GET", body?: unknown) {
    if (!session.authenticated) {
      session.requestUnlock();
      throw new Error("Unlock the private workspace to use saved hunts.");
    }
    const response = await fetch(`/api/hunts${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "The hunt could not be completed");
    return data;
  }
  useEffect(() => {
    if (!session.authenticated) {
      setConnected(false);
      setHunts([]);
      setSelected(null);
      return;
    }
    void run(async () => {
      const data = await api();
      setHunts(data.items);
      const requestedId = new URLSearchParams(window.location.search).get("hunt");
      const requested = data.items.find((hunt: Hunt) => hunt.id === requestedId);
      if (requested) {
        const detail = await api(`/${requested.id}`);
        setSelected(detail.hunt);
        setEvaluation(null);
        setEvents(detail.recentEvents || []);
        requestAnimationFrame(() => {
          selectedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          selectedSectionRef.current?.focus({ preventScroll: true });
        });
      }
      const batches = await Promise.all(
        data.items.map(async (hunt: Hunt) => {
          const response = await fetch(
            `/api/hunts/${hunt.id}/events?limit=25`,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (!response.ok) return [];
          const history = await response.json();
          return (history.items || []).map((event: Event) => ({
            ...event,
            huntName: hunt.name,
          }));
        }),
      );
      setInbox(
        batches
          .flat()
          .sort((a, b) =>
            String(b.observedAt).localeCompare(String(a.observedAt)),
          )
          .slice(0, 50),
      );
      setConnected(true);
    });
    // `api` and `run` are stable function declarations over current session state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.authenticated]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Hunt operation failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openHunt(hunt: Hunt) {
    const detail = await api(`/${hunt.id}`);
    setSelected(detail.hunt);
    setEvaluation(null);
    setEvents(detail.recentEvents || []);
  }
  function updateRule(index: number, change: Partial<Rule>) {
    setRules(
      rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)),
    );
  }
  const results =
    evaluation?.results.filter(
      (result) => filter === "all" || result.status === filter,
    ) || [];

  return (
    <main className="min-h-screen bg-[#F5F6F7] text-[#0F172A]">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-10">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
          <Crosshair size={17} /> Saved Hunts
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          Your criteria.
          <br />
          The evidence that fits.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#6B7280]">
          Save what you are looking for. Run it against collected property
          records. See why each property matches, what remains unknown, and what
          changed since your last run.
        </p>
        <div className="mt-8 flex max-w-xl items-center justify-between gap-4 rounded-xl border border-[#E5E7EB] bg-white p-5">
          <div>
            <p className="text-sm font-semibold">Private operator workspace</p>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">
              One HttpOnly session opens hunts, cases, evidence, and collection
              controls for eight hours.
            </p>
          </div>
          {session.authenticated ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await api();
                  setHunts(data.items);
                  setConnected(true);
                  setMessage("Saved hunts refreshed.");
                })
              }
              className="shrink-0 rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-semibold"
            >
              Refresh hunts
            </button>
          ) : (
            <button
              onClick={session.requestUnlock}
              className="shrink-0 rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white"
            >
              Unlock
            </button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-amber-100 p-4 text-sm text-amber-950"
          >
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-5 flex items-center gap-2 text-sm">
            <Check size={17} />
            {message}
          </p>
        )}
        {connected && (
          <section
            className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5"
            aria-label="Hunt change inbox"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-800">
                  Change inbox
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Material changes from saved hunts
                </h2>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-900">
                {inbox.length} events
              </span>
            </div>
            {inbox.length ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {inbox.slice(0, 8).map((event) => (
                  <Link
                    key={event.id}
                    href={`/listings/${encodeURIComponent(event.listingId)}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm hover:border-slate-400"
                  >
                    <strong className="block">
                      {sourceDisplayText(event.address || event.listingId)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {event.huntName} · {event.type.replaceAll("_", " ")} ·{" "}
                      {new Date(event.observedAt).toLocaleString()}
                    </span>
                    <span className="mt-2 block text-xs text-slate-700">
                      {sourceDisplayText(event.message)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                No durable hunt events yet. A first run establishes a baseline;
                later source observations can create explainable changes.
              </p>
            )}
          </section>
        )}
        {connected && (
          <section className="mt-7 rounded-2xl border border-[#E5E7EB] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Start with a hunt that has a job
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                  Load a template into the same editable criteria builder used
                  by every saved hunt.
                </p>
              </div>
              <div className="flex max-w-xl flex-1 gap-2">
                <input
                  aria-label="Describe a hunt"
                  value={plainQuery}
                  onChange={(event) => setPlainQuery(event.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => {
                    const compiled = compileHuntQuery(plainQuery);
                    if (compiled.criteria.rules.length) {
                      setName(`Hunt: ${plainQuery.slice(0, 60)}`);
                      setMode(compiled.criteria.mode);
                      setRules(compiled.criteria.rules);
                    }
                    setMissingDependencies(compiled.missingDependencies);
                    setMessage(
                      compiled.criteria.rules.length
                        ? "The request was compiled into visible criteria below. Edit every field before saving."
                        : "No supported criteria were found. Review the missing data dependency.",
                    );
                  }}
                  className="shrink-0 rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white"
                >
                  Draft criteria
                </button>
              </div>
            </div>
            {missingDependencies.length > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                Missing data: {missingDependencies.join("; ")}. These requests
                remain unsupported until that evidence is connected.
              </p>
            )}
            <div className="mt-4 grid gap-2 md:grid-cols-5">
              {huntTemplates.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => {
                    setName(template.name);
                    setMode("all");
                    setRules(template.rules());
                    setMissingDependencies([]);
                    setMessage(
                      `${template.name} loaded. Edit the criteria, then save it.`,
                    );
                  }}
                  className="rounded-xl border border-[#E5E7EB] p-3 text-left hover:border-slate-900"
                >
                  <span className="block text-xs font-semibold">
                    {template.name}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#6B7280]">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {connected && (
          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[340px_1fr]">
            <aside className="space-y-6">
              <form
                className="rounded-2xl border border-[#E5E7EB] bg-white p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const data = await api("", "POST", {
                      name,
                      criteria: {
                        mode,
                        rules: rules.map((rule) =>
                          ["known", "unknown"].includes(rule.operator)
                            ? { field: rule.field, operator: rule.operator }
                            : rule,
                        ),
                      },
                    });
                    setHunts((items) => [data.hunt, ...items]);
                    setSelected(data.hunt);
                    setEvaluation(null);
                    setEvents([]);
                    setMessage(
                      "Hunt saved. Run it to establish the first comparison.",
                    );
                  });
                }}
              >
                <h2 className="text-lg font-semibold">Build a hunt</h2>
                <label className="mt-4 block text-xs font-semibold">
                  Name
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={`${inputClass} mt-2`}
                  />
                </label>
                <label className="mt-4 block text-xs font-semibold">
                  Match
                  <select
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as "all" | "any")
                    }
                    className={`${inputClass} mt-2`}
                  >
                    <option value="all">Every criterion</option>
                    <option value="any">Any criterion</option>
                  </select>
                </label>
                <div className="mt-4 space-y-3">
                  {rules.map((rule, index) => {
                    const type =
                      fields.find(([field]) => field === rule.field)?.[2] ||
                      "text";
                    return (
                      <fieldset
                        key={index}
                        className="space-y-2 rounded-xl border border-[#E5E7EB] p-3"
                      >
                        <legend className="px-1 text-[10px] font-semibold">
                          Criterion {index + 1}
                        </legend>
                        <div className="flex gap-2">
                          <select
                            aria-label={`Criterion ${index + 1} field`}
                            value={rule.field}
                            onChange={(event) => {
                              const nextType =
                                fields.find(
                                  ([field]) => field === event.target.value,
                                )?.[2] || "text";
                              updateRule(index, {
                                field: event.target.value,
                                operator: operators[nextType][0][0],
                                value: nextType === "number" ? 100000 : "",
                              });
                            }}
                            className={inputClass}
                          >
                            {fields.map(([field, title]) => (
                              <option key={field} value={field}>
                                {title}
                              </option>
                            ))}
                          </select>
                          {rules.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove criterion ${index + 1}`}
                              onClick={() =>
                                setRules(rules.filter((_, i) => i !== index))
                              }
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                        <select
                          aria-label={`Criterion ${index + 1} operator`}
                          value={rule.operator}
                          onChange={(event) =>
                            updateRule(index, { operator: event.target.value })
                          }
                          className={inputClass}
                        >
                          {operators[type].map(([operator, title]) => (
                            <option key={operator} value={operator}>
                              {title}
                            </option>
                          ))}
                        </select>
                        {!["known", "unknown"].includes(rule.operator) && (
                          <input
                            aria-label={`Criterion ${index + 1} value`}
                            required
                            type={type}
                            step={type === "number" ? "any" : undefined}
                            value={rule.value ?? ""}
                            placeholder={
                              rule.field === "source"
                                ? "e.g. gsa"
                                : rule.field === "state"
                                  ? "e.g. FL"
                                  : "Value"
                            }
                            onChange={(event) =>
                              updateRule(index, {
                                value:
                                  type === "number" && event.target.value !== ""
                                    ? Number(event.target.value)
                                    : event.target.value,
                              })
                            }
                            className={inputClass}
                          />
                        )}
                      </fieldset>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={rules.length >= 20}
                  onClick={() =>
                    setRules([
                      ...rules,
                      { field: "openingBid", operator: "lte", value: 150000 },
                    ])
                  }
                  className="mt-3 flex items-center gap-1 text-xs font-semibold disabled:opacity-50"
                >
                  <Plus size={14} /> Add criterion
                </button>
                <p className="mt-4 text-xs leading-5 text-[#6B7280]">
                  Missing facts stay unknown. Only source-observed records enter
                  the hunt; a missing record never means sold.
                </p>
                <button
                  disabled={busy}
                  className="mt-5 w-full rounded-lg bg-[#0F172A] px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save hunt
                </button>
              </form>
              <div>
                <h2 className="mb-3 text-sm font-semibold">
                  Your hunts · {hunts.length}
                </h2>
                <div className="space-y-2">
                  {hunts.map((hunt) => (
                    <button
                      key={hunt.id}
                      disabled={busy}
                      onClick={() => void run(() => openHunt(hunt))}
                      className={`w-full rounded-xl border p-4 text-left ${selected?.id === hunt.id ? "border-[#0F172A] bg-slate-100" : "border-[#E5E7EB] bg-white"}`}
                    >
                      <span className="block text-sm font-semibold">
                        {hunt.name}
                      </span>
                      <span className="mt-1 block text-xs text-[#6B7280]">
                        Version {hunt.version} ·{" "}
                        {hunt.enabled ? "Enabled" : "Paused"}
                      </span>
                    </button>
                  ))}
                  {!hunts.length && (
                    <p className="text-sm text-[#6B7280]">
                      Your first hunt starts above.
                    </p>
                  )}
                </div>
              </div>
            </aside>
            <section
              ref={selectedSectionRef}
              tabIndex={-1}
              className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"
              aria-label="Hunt evidence"
            >
              {selected ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-900">
                        Evidence search · Version {selected.version}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {selected.name}
                      </h2>
                      <p className="mt-2 text-xs text-[#6B7280]">
                        {"discoveryFilters" in selected.criteria
                          ? "Matches the filters saved from Discover."
                          : `${selected.criteria.mode === "all" ? "Every" : "Any"} criterion must match.`}
                      </p>
                    </div>
                    <button
                      disabled={busy || !selected.enabled}
                      onClick={() =>
                        void run(async () => {
                          const data = await api(
                            `/${selected.id}/evaluate`,
                            "POST",
                            {},
                          );
                          setEvaluation(data.evaluation);
                          const history = await api(`/${selected.id}/events`);
                          setEvents(history.items);
                          setMessage(
                            data.evaluation.baselineCreated
                              ? "First comparison saved. Future runs can identify new matches and changes."
                              : "Hunt evaluated against collected source evidence.",
                          );
                        })
                      }
                      className="flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Crosshair size={15} />
                      )}
                      Check for changes
                    </button>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {"discoveryFilters" in selected.criteria
                      ? Object.entries(selected.criteria.discoveryFilters ?? {}).map(([key, value]) => (
                        <span key={key} className="rounded-full bg-[#F1F5F9] px-3 py-1.5 text-[11px]">
                          {discoveryFilterLabels[key] || key.replaceAll("_", " ")}: {value === "unknown" ? "Unknown" : display(value)}
                        </span>
                      ))
                      : selected.criteria.rules.map((rule, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-[#F1F5F9] px-3 py-1.5 text-[11px]"
                      >
                        {label(rule.field)} {rule.operator.replaceAll("_", " ")}{" "}
                        {!["known", "unknown"].includes(rule.operator) &&
                          display(rule.value)}
                      </span>
                    ))}
                    {"discoveryFilters" in selected.criteria && !Object.keys(selected.criteria.discoveryFilters ?? {}).length && (
                      <span className="rounded-full bg-[#F1F5F9] px-3 py-1.5 text-[11px]">All discovered properties</span>
                    )}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const data = await api(`/${selected.id}`, "PATCH", {
                          enabled: !selected.enabled,
                        });
                        setSelected(data.hunt);
                        setHunts(
                          hunts.map((hunt) =>
                            hunt.id === data.hunt.id ? data.hunt : hunt,
                          ),
                        );
                      })
                    }
                    className="mt-4 text-xs font-semibold underline"
                  >
                    {selected.enabled ? "Pause this hunt" : "Enable this hunt"}
                  </button>
                  <p className="mt-3 text-xs leading-5 text-[#6B7280]">
                    Enabled searches are also checked as new source collections finish.
                  </p>
                  {evaluation ? (
                    <>
                      <div className="mt-6 grid grid-cols-3 gap-3">
                        {[
                          ["match", "Matches"],
                          ["unknown", "Need evidence"],
                          ["noMatch", "Do not match"],
                        ].map(([key, title]) => (
                          <div
                            key={key}
                            className="rounded-xl bg-[#F5F6F7] p-4"
                          >
                            <p className="text-2xl font-semibold">
                              {evaluation.counts[key] || 0}
                            </p>
                            <p className="mt-1 text-[11px] text-[#6B7280]">
                              {title}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs leading-5 text-[#6B7280]">
                        {evaluation.counts.accepted} validated records
                        evaluated. {evaluation.counts.rejected || 0} unverified
                        records excluded. {evaluation.counts.notObserved || 0}{" "}
                        earlier records were not observed in this run; no sale
                        or disappearance is inferred.
                      </p>
                      <label className="mt-6 flex items-center justify-between gap-3 text-sm font-semibold">
                        Inspect results
                        <select
                          aria-label="Hunt result filter"
                          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-normal"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                        >
                          <option value="match">Matches</option>
                          <option value="unknown">Need evidence</option>
                          <option value="no_match">Do not match</option>
                          <option value="all">All returned results</option>
                        </select>
                      </label>
                      <div className="mt-4 space-y-3">
                        {results.map((result) => (
                          <article
                            key={result.listingId}
                            className="rounded-xl border border-[#E5E7EB] p-4"
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <Link
                                href={`/listings/${encodeURIComponent(result.listingId)}`}
                                className="text-sm font-semibold underline"
                              >
                                {sourceDisplayText(
                                  result.address || result.listingId,
                                )}
                              </Link>
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${result.status === "match" ? "bg-emerald-100" : result.status === "unknown" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}
                              >
                                {result.status.replaceAll("_", " ")}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-[#6B7280]">
                              {sourceDisplayText(result.sourceId)} · Observed{" "}
                              {new Date(result.observedAt).toLocaleString()}
                            </p>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-semibold">
                                Why this result
                              </summary>
                              <div className="mt-3 space-y-3">
                                {result.clauseResults.map((clause, index) => (
                                  <div
                                    key={index}
                                    className="border-l-2 border-slate-200 pl-3"
                                  >
                                    <p className="text-xs font-semibold">
                                      {label(clause.field)} ·{" "}
                                      {clause.status.replaceAll("_", " ")}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                                      {sourceDisplayText(clause.reason)}
                                    </p>
                                    <p className="mt-1 text-[10px] text-[#6B7280]">
                                      Observed value: {display(clause.actual)} ·{" "}
                                      {clause.evidenceClass.replaceAll(
                                        "_",
                                        " ",
                                      )}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </details>
                            <div className="mt-4 flex flex-wrap gap-4">
                              <Link
                                href={`/listings/${encodeURIComponent(result.listingId)}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold"
                              >
                                Open evidence dossier <ArrowRight size={12} />
                              </Link>
                              <a
                                href={result.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs underline"
                              >
                                Publisher record <ExternalLink size={12} />
                              </a>
                            </div>
                          </article>
                        ))}
                        {!results.length && (
                          <p className="rounded-xl bg-[#F5F6F7] p-5 text-sm leading-6 text-[#6B7280]">
                            No returned results in this category. Try another
                            filter or collect more source evidence.
                          </p>
                        )}
                      </div>
                      {evaluation.resultsTruncated && (
                        <p className="mt-3 text-xs text-amber-800">
                          The result display is bounded. Counts cover the full
                          accepted inventory; narrow this hunt to inspect more
                          of its matches.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="mt-6 rounded-xl bg-[#F5F6F7] p-6">
                      <h3 className="font-semibold">Start with a comparison</h3>
                      <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                        Run this hunt to inspect the available evidence and save
                        a comparison point. Future runs separate newly matching
                        records, changed facts, and records that no longer fit.
                      </p>
                    </div>
                  )}
                  <div className="mt-8 border-t border-[#E5E7EB] pt-6">
                    <h3 className="text-lg font-semibold">What changed</h3>
                    {events.length ? (
                      <div className="mt-4 space-y-3">
                        {events.slice(0, 30).map((event) => (
                          <div
                            key={event.id}
                            className="rounded-xl bg-[#F5F6F7] p-4"
                          >
                            <p className="text-xs font-semibold">
                              {event.type.replaceAll("_", " ")} ·{" "}
                              {sourceDisplayText(
                                event.address || event.listingId,
                              )}
                            </p>
                            <p className="mt-2 text-xs leading-6 text-[#6B7280]">
                              {sourceDisplayText(event.message)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-[#6B7280]">
                        No comparison events yet. A first run establishes the
                        baseline; later runs require changed evidence before
                        reporting a change.
                      </p>
                    )}
                    <p className="mt-4 text-xs leading-5 text-[#6B7280]">
                      Hunts run when you choose Run hunt. No email or text
                      notifications are sent.
                    </p>
                  </div>
                </>
              ) : (
                <div className="py-10">
                  <Crosshair size={34} />
                  <h2 className="mt-4 text-2xl font-semibold">
                    Make the search yours.
                  </h2>
                  <p className="mt-3 max-w-md text-sm leading-7 text-[#6B7280]">
                    Create a hunt or open a saved one. Every match will show the
                    source observation and a reason for each criterion.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
