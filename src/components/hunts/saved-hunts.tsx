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
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import { compileHuntQuery, formatIsoDate } from "@/lib/hunt-query";

type Rule = { field: string; operator: string; value?: string | number };
type Hunt = {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  webhookUrl?: string | null;
  notifyEmail?: string | null;
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
  relevance?: {
    rank: number;
    band: string;
    dealScoreBand?: string | null;
    researchQualityScore?: number;
    urgency?: string;
    factors?: { factor: string; weight: number; detail: string }[];
    note?: string;
  } | null;
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
  rankingNote?: string;
  unsatisfiableCriteria?: { field: string; operator: string; value?: unknown; reason: string }[];
  unsatisfiableCriteriaNote?: string | null;
  webhook?: { delivery: string; sent: boolean; reason?: string };
  email?: { delivery: string; sent: boolean; reason?: string };
};

const fields = [
  ["state", "State", "text"],
  ["source", "Listing source", "text"],
  ["county", "County", "text"],
  ["propType", "Property type", "text"],
  ["status", "Sale status", "text"],
  ["auctionProgram", "Auction program", "text"],
  ["lifecycleStatus", "Sale stage", "text"],
  ["occupancy", "Occupancy", "text"],
  ["sourceObservedAt", "Last updated", "date"],
  ["openingBid", "Opening bid", "number"],
  ["sqft", "Square footage", "number"],
  ["saleDate", "Sale date", "date"],
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
const evidenceLabels: Record<string, string> = {
  publisher_reported: "Listing record",
  observation_metadata: "Update timing",
  derived_from_listing_values: "Calculated from listing",
  derived_unverified: "Unverified estimate",
  canonical_discovery_query: "Saved Discover filter",
};
const eventTypeLabels: Record<string, string> = {
  new_match: "New match",
  material_change: "Updated listing",
  no_longer_matches: "No longer matches",
  evaluation_unknown: "Missing details",
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
  program: "Program", lifecycle: "Sale stage", saleFrom: "Sale from", saleTo: "Sale through",
  maxBid: "Maximum bid", minScore: "Minimum score", minEquity: "Minimum equity",
  occupancy: "Occupancy", freshness: "Freshness", hasDocuments: "Documents",
  hasPhoto: "Photos", seniorLien: "Senior lien", redemption: "Redemption",
  distressStage: "Sale type", minQuality: "Minimum listing detail",
  excludeTerminal: "Active sales only", isNew: "New listings",
  priceDropped: "Price drops", stale: "Stale records", occupancyKnown: "Occupancy known",
};
const inputClass =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2.5 text-sm outline-ink";

const addUtcDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
};

const normalizeSubmittedRules = (items: Rule[]) =>
  items.map((rule) =>
    ["known", "unknown"].includes(rule.operator)
      ? { field: rule.field, operator: rule.operator }
      : rule,
  );

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
    name: "Program and sale-stage review",
    description:
      "Track properties that list an auction program and sale stage.",
    rules: () => [
      { field: "auctionProgram", operator: "known" },
      { field: "lifecycleStatus", operator: "known" },
    ],
  },
  {
    name: "Approaching published sale",
    description: "Find upcoming auction dates within the next 14 days.",
    rules: () => [
      {
        field: "saleDate",
        operator: "on_or_after",
        value: formatIsoDate(),
      },
      {
        field: "saleDate",
        operator: "on_or_before",
        value: addUtcDays(14),
      },
    ],
  },
  {
    name: "Square-footage review",
    description:
      "Find properties with reported square footage to compare against county parcel records.",
    rules: () => [{ field: "sqft", operator: "known" }],
  },
  {
    name: "Alachua Second Chance",
    description:
      "Track Alachua County properties marked available for public sale.",
    rules: () => [
      { field: "county", operator: "eq", value: "Alachua" },
      { field: "status", operator: "eq", value: "available_for_public" },
    ],
  },
];

function RuleBuilderFields({
  rules,
  onChange,
  idPrefix,
}: {
  rules: Rule[];
  onChange: (next: Rule[]) => void;
  idPrefix: string;
}) {
  function updateRule(index: number, change: Partial<Rule>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));
  }

  return (
    <>
      <div className="mt-4 space-y-3">
        {rules.map((rule, index) => {
          const type = fields.find(([field]) => field === rule.field)?.[2] || "text";
          return (
            <fieldset
              key={`${idPrefix}-${index}`}
              className="space-y-2 rounded-control border border-line p-3"
            >
              <legend className="px-1 text-label font-semibold">
                Criterion {index + 1}
              </legend>
              <div className="flex gap-2">
                <select
                  aria-label={`${idPrefix} criterion ${index + 1} field`}
                  value={rule.field}
                  onChange={(event) => {
                    const nextType =
                      fields.find(([field]) => field === event.target.value)?.[2] || "text";
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
                    aria-label={`Remove ${idPrefix.toLowerCase()} criterion ${index + 1}`}
                    onClick={() => onChange(rules.filter((_, i) => i !== index))}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <select
                aria-label={`${idPrefix} criterion ${index + 1} operator`}
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
                  aria-label={`${idPrefix} criterion ${index + 1} value`}
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
          onChange([
            ...rules,
            { field: "openingBid", operator: "lte", value: 150000 },
          ])
        }
        className="mt-3 flex items-center gap-1 text-xs font-semibold disabled:opacity-50"
      >
        <Plus size={14} /> Add criterion
      </button>
    </>
  );
}

export function SavedHunts() {
  const { messages: m } = useLocale();
  const session = useWorkspaceSession();
  const [connected, setConnected] = useState(false);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [selected, setSelected] = useState<Hunt | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [inbox, setInbox] = useState<(Event & { huntName: string })[]>([]);
  const [inboxError, setInboxError] = useState("");
  const [name, setName] = useState("My overlooked-property hunt");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [mode, setMode] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<Rule[]>([
    { field: "state", operator: "eq", value: "FL" },
  ]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [editNotifyEmail, setEditNotifyEmail] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editMode, setEditMode] = useState<"all" | "any">("all");
  const [editRules, setEditRules] = useState<Rule[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("match");
  const [plainQuery, setPlainQuery] = useState(
    "Vacant land in Alachua County under $150k within 30 days",
  );
  const [missingDependencies, setMissingDependencies] = useState<string[]>([]);
  const [queryWarnings, setQueryWarnings] = useState<string[]>([]);
  const selectedSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!emailTouched && !notifyEmail && session.member?.email) {
      setNotifyEmail(session.member.email);
    }
  }, [emailTouched, notifyEmail, session.member?.email]);

  function applySelectedHunt(huntDetail: Hunt | null, recentEvents: Event[] = []) {
    setSelected(huntDetail);
    setEvaluation(null);
    setEvents(recentEvents);
    setEventsError("");
    setEditing(false);
    setConfirmDelete(false);
    if (!huntDetail) {
      setEditName("");
      setEditWebhookUrl("");
      setEditNotifyEmail("");
      setEditEnabled(true);
      setEditMode("all");
      setEditRules([]);
      return;
    }
    setEditName(huntDetail.name || "");
    setEditWebhookUrl(huntDetail.webhookUrl || "");
    setEditNotifyEmail(huntDetail.notifyEmail || "");
    setEditEnabled(huntDetail.enabled);
    if ("rules" in huntDetail.criteria && Array.isArray(huntDetail.criteria.rules)) {
      setEditMode(huntDetail.criteria.mode ?? "all");
      setEditRules(huntDetail.criteria.rules.map((rule) => ({ ...rule })));
    } else {
      setEditMode("all");
      setEditRules([]);
    }
  }

  async function api(path = "", method = "GET", body?: unknown) {
    if (!session.memberTools) {
      session.requestUnlock();
      throw new Error("Sign in as an active member or unlock the workspace to use saved hunts.");
    }
    const response = await fetch(`/api/hunts${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.details?.[0] || data.error || `The hunt could not be completed (HTTP ${response.status})`);
    return data;
  }

  async function loadInbox(items: Hunt[]) {
    if (!items.length) {
      setInbox([]);
      setInboxError("");
      return;
    }
    const failedHunts: string[] = [];
    const batches = await Promise.all(
      items.map(async (hunt) => {
        try {
          const response = await fetch(
            `/api/hunts/${encodeURIComponent(hunt.id)}/events?limit=25`,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (!response.ok) {
            failedHunts.push(hunt.name);
            return [];
          }
          const history = await response.json().catch(() => null);
          if (!history || !Array.isArray(history.items)) {
            failedHunts.push(hunt.name);
            return [];
          }
          return history.items.map((event: Event) => ({
            ...event,
            huntName: hunt.name,
          }));
        } catch {
          failedHunts.push(hunt.name);
          return [];
        }
      }),
    );
    if (failedHunts.length === items.length) {
      setInboxError("Recent change events could not be loaded. Try refreshing hunts.");
    } else if (failedHunts.length > 0) {
      setInboxError(
        `Could not load change events for: ${failedHunts.slice(0, 3).join(", ")}${failedHunts.length > 3 ? ` (+${failedHunts.length - 3} more)` : ""}.`,
      );
    } else {
      setInboxError("");
    }
    setInbox(
      batches
        .flat()
        .sort((a, b) =>
          String(b.observedAt).localeCompare(String(a.observedAt)),
        )
        .slice(0, 50),
    );
  }

  async function refreshAll(preferredHuntId?: string | null) {
    const data = await api();
    const items: Hunt[] = Array.isArray(data.items) ? data.items : [];
    setHunts(items);
    const targetId = preferredHuntId ?? selected?.id ?? null;
    if (targetId) {
      const target = items.find((hunt) => hunt.id === targetId);
      if (target) {
        const detail = await api(`/${target.id}`);
        applySelectedHunt(detail.hunt, detail.recentEvents || []);
      } else {
        applySelectedHunt(null, []);
      }
    }
    await loadInbox(items);
    setConnected(true);
    return items;
  }

  useEffect(() => {
    if (!session.memberTools) {
      setConnected(false);
      setHunts([]);
      setInbox([]);
      setInboxError("");
      applySelectedHunt(null, []);
      return;
    }
    void run(async () => {
      const requestedId = new URLSearchParams(window.location.search).get("hunt");
      await refreshAll(requestedId);
      if (requestedId) {
        requestAnimationFrame(() => {
          selectedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          selectedSectionRef.current?.focus({ preventScroll: true });
        });
      }
    });
    // `api`, `run`, and `refreshAll` read current session state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.memberTools]);

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
    applySelectedHunt(detail.hunt, detail.recentEvents || []);
  }

  const results =
    evaluation?.results.filter(
      (result) => filter === "all" || result.status === filter,
    ) || [];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper text-ink outline-none">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-10">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-ink-3">
          <Crosshair size={17} /> {m.workspacePages.huntsEyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          {m.workspacePages.huntsHeadingLine1}
          <br />
          {m.workspacePages.huntsHeadingLine2}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink-3">
          {m.workspacePages.huntsSub}
        </p>
        <div className="mt-8 flex max-w-xl items-center justify-between gap-4 rounded-card border border-line bg-card p-5">
          <div>
            <p className="text-sm font-semibold">
              {session.member?.entitled && !session.authenticated
                ? `Your hunts · ${session.member.email}`
                : session.member && !session.memberTools
                  ? `Member account · ${session.member.email}`
                  : "Hunts"}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-3">
              {session.loading
                ? "Checking your workspace session..."
                : session.memberTools
                  ? "Hunts re-run after every collection and email you when a match appears or changes."
                  : session.member
                    ? "Your account does not have an active membership yet. Upgrade on our pricing page to save and monitor hunts."
                    : "Sign in with a member account to save hunts, compare source updates, and receive email alerts."}
            </p>
          </div>
          {session.loading ? null : session.memberTools ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await refreshAll();
                  setMessage("Saved hunts and change inbox refreshed.");
                })
              }
              className="shrink-0 rounded-lg border border-line-strong px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {m.workspacePages.huntsRefreshBtn}
            </button>
          ) : session.member ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/pricing"
                className="rounded-control bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-ink-2"
              >
                View plans
              </Link>
              <Link
                href="/account"
                className="rounded-control border border-line-strong bg-card px-4 py-2 text-xs font-semibold text-ink-2 hover:bg-paper"
              >
                Account
              </Link>
            </div>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href="/sign-in"
                className="rounded-control bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-ink-2"
              >
                {m.workspacePages.huntsMemberBtn}
              </Link>
              <button
                type="button"
                onClick={session.requestUnlock}
                className="rounded-control border border-line-strong bg-card px-4 py-2 text-xs font-semibold text-ink-2 hover:bg-paper"
              >
                {m.common.unlock}
              </button>
            </div>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-control bg-catch-wash p-4 text-sm text-catch-ink"
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
        {!session.loading && !session.memberTools && (
          <section className="mt-8 rounded-card border border-line bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold">
              {session.member
                ? "Membership required for saved hunts"
                : "Sign in to manage saved hunts"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-3">
              {session.member
                ? "Saved hunts continuously check new county, sheriff, and federal listings against your bid, location, and sale-date criteria and notify you by email or webhook."
                : "Create or sign in to a member account to save up to 20 custom property hunts, review change history, and receive automated alerts."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {session.member ? (
                <>
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-2"
                  >
                    Upgrade membership <ArrowRight size={15} />
                  </Link>
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-card"
                  >
                    Browse listings free
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/sign-in"
                    className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-2"
                  >
                    {m.workspacePages.huntsMemberBtn} <ArrowRight size={15} />
                  </Link>
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-card"
                  >
                    View plans
                  </Link>
                </>
              )}
            </div>
          </section>
        )}
        {session.memberTools && !connected && (
          <section className="mt-8 rounded-card border border-line bg-card p-6">
            {error ? (
              <>
                <h2 className="text-lg font-semibold">Saved hunts could not be loaded</h2>
                <p className="mt-2 text-sm text-ink-3">{error}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => { await refreshAll(); })}
                  className="mt-4 rounded-control bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Retry
                </button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-3">
                <Loader2 size={16} className="animate-spin" /> Loading your saved hunts...
              </p>
            )}
          </section>
        )}
        {connected && (
          <section
            className="mt-6 rounded-card border border-line bg-paper p-5"
            aria-label="Hunt change inbox"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink-2">
                  Change inbox
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Material changes from saved hunts
                </h2>
              </div>
              <span className="rounded-full bg-card px-3 py-1 text-xs font-bold text-ink">
                {inbox.length} events
              </span>
            </div>
            {inboxError && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-catch-wash p-3 text-xs leading-5 text-catch-ink"
              >
                {inboxError}
              </p>
            )}
            {inbox.length ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {inbox.slice(0, 8).map((event) => (
                  <Link
                    key={event.id}
                    href={`/listings/${encodeURIComponent(event.listingId)}`}
                    className="rounded-control border border-line bg-card p-3 text-sm hover:border-ink-3"
                  >
                    <strong className="block">
                      {sourceDisplayText(event.address || event.listingId)}
                    </strong>
                    <span className="mt-1 block text-xs text-ink-3">
                      {event.huntName} · {eventTypeLabels[event.type] || event.type.replaceAll("_", " ")} ·{" "}
                      {new Date(event.observedAt).toLocaleString()}
                    </span>
                    <span className="mt-2 block text-xs text-ink-2">
                      {sourceDisplayText(event.message)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-3">
                No matching properties or updates yet. Run a hunt once to set a
                baseline, then check again after new listings arrive to see what
                changed.
              </p>
            )}
          </section>
        )}
        {connected && (
          <section className="mt-7 rounded-card border border-line bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Start from a template or describe what you want
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-3">
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
                    setQueryWarnings(compiled.warnings);
                    setMessage(
                      compiled.criteria.rules.length
                        ? compiled.warnings.length
                          ? "We turned the recognized parts of your description into editable criteria below. Review the unrecognized terms note before saving."
                          : "We turned your description into editable criteria below. Review every field before saving."
                        : "No matching filter rule was recognized. See the note below.",
                    );
                  }}
                  className="shrink-0 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white"
                >
                  Draft criteria
                </button>
              </div>
            </div>
            {queryWarnings.length > 0 && (
              <p
                role="status"
                className="mt-3 rounded-lg bg-catch-wash p-3 text-xs leading-5 text-catch-ink"
              >
                {queryWarnings.join(" ")}
              </p>
            )}
            {missingDependencies.length > 0 && (
              <p className="mt-3 rounded-lg bg-catch-wash p-3 text-xs leading-5 text-catch-ink">
                Unsupported request: {missingDependencies.join("; ")}. Those
                fields are not yet available as automated hunt filters.
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {huntTemplates.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => {
                    setName(template.name);
                    setMode("all");
                    setRules(template.rules());
                    setMissingDependencies([]);
                    setQueryWarnings([]);
                    setMessage(
                      `${template.name} loaded. Edit the criteria, then save it.`,
                    );
                  }}
                  className="rounded-control border border-line p-3 text-left hover:border-ink"
                >
                  <span className="block text-xs font-semibold">
                    {template.name}
                  </span>
                  <span className="mt-1 block text-meta leading-4 text-ink-3">
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
                className="rounded-card border border-line bg-card p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const data = await api("", "POST", {
                      name,
                      webhookUrl: webhookUrl.trim() || undefined,
                      notifyEmail: notifyEmail.trim() || undefined,
                      criteria: {
                        mode,
                        rules: normalizeSubmittedRules(rules),
                      },
                    });
                    setHunts((items) => [data.hunt, ...items]);
                    applySelectedHunt(data.hunt, []);
                    setMessage(
                      "Hunt saved. Click Check for changes to run the first comparison.",
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
                  Email alerts <span className="text-label font-normal text-ink-3">(Sent when a later run finds a new match or a changed fact.)</span>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    maxLength={254}
                    value={notifyEmail}
                    onChange={(event) => {
                      setEmailTouched(true);
                      setNotifyEmail(event.target.value);
                    }}
                    className={`${inputClass} mt-2`}
                  />
                </label>
                <label className="mt-4 block text-xs font-semibold">
                  Webhook URL <span className="text-label font-normal text-ink-3">(Public https address. Posted when a later run finds a new match or a changed fact.)</span>
                  <input
                    type="url"
                    placeholder="https://example.com/api/webhooks/property-alerts"
                    maxLength={256}
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
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
                <RuleBuilderFields
                  rules={rules}
                  onChange={setRules}
                  idPrefix="Create"
                />
                <p className="mt-4 text-xs leading-5 text-ink-3">
                  Only listings backed by observed public records are matched;
                  missing fields stay unknown instead of being guessed.
                </p>
                <button
                  disabled={busy}
                  className="mt-5 w-full rounded-lg bg-ink px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save hunt
                </button>
              </form>
              <div>
                <h2 className="mb-3 text-sm font-semibold">
                  Your hunts · {hunts.length} / 20
                </h2>
                <div className="space-y-2">
                  {hunts.map((hunt) => (
                    <button
                      key={hunt.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => openHunt(hunt))}
                      className={`w-full rounded-control border p-4 text-left ${selected?.id === hunt.id ? "border-ink bg-paper" : "border-line bg-card"}`}
                    >
                      <span className="block text-sm font-semibold">
                        {hunt.name}
                      </span>
                      <span className="mt-1 block text-xs text-ink-3">
                        Version {hunt.version} ·{" "}
                        {hunt.enabled ? "Enabled" : "Paused"}
                      </span>
                    </button>
                  ))}
                  {!hunts.length && (
                    <p className="text-sm text-ink-3">
                      Your first hunt starts above.
                    </p>
                  )}
                </div>
              </div>
            </aside>
            <section
              ref={selectedSectionRef}
              tabIndex={-1}
              className="rounded-card border border-line bg-card p-5 sm:p-7"
              aria-label="Hunt details and results"
            >
              {selected ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-label font-bold uppercase tracking-widest text-ink">
                        Saved hunt · Version {selected.version}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {selected.name}
                      </h2>
                      {selected.notifyEmail && (
                        <p className="mt-1 flex items-center gap-1.5 font-mono text-label text-ink-2">
                          <span className="rounded bg-go-wash px-1.5 py-0.5 font-semibold text-go">Email</span>
                          <span className="truncate max-w-sm">{selected.notifyEmail}</span>
                        </p>
                      )}
                      {selected.webhookUrl && (
                        <p className="mt-1 flex items-center gap-1.5 font-mono text-label text-ink-2">
                          <span className="rounded bg-go-wash px-1.5 py-0.5 font-semibold text-go">Webhook</span>
                          <span className="truncate max-w-sm">{selected.webhookUrl}</span>
                        </p>
                      )}
                      <p className="mt-2 text-xs text-ink-3">
                        {"discoveryFilters" in selected.criteria
                          ? "Matches the filters saved from Discover."
                          : `${selected.criteria.mode === "all" ? "Every" : "Any"} criterion must match.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !selected.enabled}
                        onClick={() =>
                          void run(async () => {
                            const data = await api(
                              `/${selected.id}/evaluate`,
                              "POST",
                              {},
                            );
                            setEvaluation(data.evaluation);
                            try {
                              const history = await api(`/${selected.id}/events`);
                              setEvents(history.items || []);
                              setEventsError("");
                            } catch (caught) {
                              setEventsError(
                                caught instanceof Error
                                  ? caught.message
                                  : "Could not refresh change events for this hunt.",
                              );
                            }
                            await loadInbox(hunts);
                            const base = data.evaluation.baselineCreated
                              ? "Baseline saved. Future checks will highlight new matches and price or date changes."
                              : "Check complete against current property records.";
                            const hook = data.evaluation.webhook;
                            const delivery = !hook || hook.delivery === "skipped"
                              ? ""
                              : hook.sent
                                ? " The webhook accepted this notice."
                                : hook.delivery === "refused"
                                  ? " The webhook address is not a public https endpoint, so nothing was sent."
                                  : " The webhook did not accept the notice.";
                            const mail = data.evaluation.email;
                            const mailNote = !mail || mail.delivery === "skipped"
                              ? ""
                              : mail.sent
                                ? " Alert email sent."
                                : mail.delivery === "local"
                                  ? " Alert email queued to the local outbox (RESEND_API_KEY is not set)."
                                  : " The alert email could not be sent.";
                            setMessage(`${base}${delivery}${mailNote}`);
                          })
                        }
                        className="flex items-center gap-2 rounded-lg bg-ink px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Crosshair size={15} />
                        )}
                        Check for changes
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmDelete(false);
                          setEditing((prev) => {
                            if (!prev && selected) {
                              setEditName(selected.name || "");
                              setEditWebhookUrl(selected.webhookUrl || "");
                              setEditNotifyEmail(selected.notifyEmail || "");
                              setEditEnabled(selected.enabled);
                              if ("rules" in selected.criteria && Array.isArray(selected.criteria.rules)) {
                                setEditMode(selected.criteria.mode ?? "all");
                                setEditRules(selected.criteria.rules.map((rule) => ({ ...rule })));
                              }
                            }
                            return !prev;
                          });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-3 text-xs font-semibold text-ink-2 hover:bg-paper disabled:opacity-50"
                      >
                        <Pencil size={14} /> {editing ? "Close editor" : "Edit"}
                      </button>
                      {!confirmDelete ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(false);
                            setConfirmDelete(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-3 text-xs font-semibold text-catch-ink hover:bg-catch-wash disabled:opacity-50"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-lg border border-catch/40 bg-catch-wash px-2.5 py-1.5">
                          <span className="text-xs font-semibold text-catch-ink">
                            Delete hunt?
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const deletedId = selected.id;
                                await api(`/${deletedId}`, "DELETE");
                                const remaining = hunts.filter((item) => item.id !== deletedId);
                                setHunts(remaining);
                                applySelectedHunt(null, []);
                                await loadInbox(remaining);
                                setMessage("Hunt deleted.");
                              })
                            }
                            className="rounded bg-ink px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDelete(false)}
                            className="rounded px-2 py-1.5 text-xs font-semibold text-ink-2 hover:bg-card"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {editing && (
                    <form
                      className="mt-5 rounded-control border border-line bg-paper p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          const payload: Record<string, unknown> = {
                            name: editName,
                            enabled: editEnabled,
                            notifyEmail: editNotifyEmail.trim(),
                            webhookUrl: editWebhookUrl.trim(),
                          };
                          if (!("discoveryFilters" in selected.criteria)) {
                            payload.criteria = {
                              mode: editMode,
                              rules: normalizeSubmittedRules(editRules),
                            };
                          }
                          const data = await api(`/${selected.id}`, "PATCH", payload);
                          const updated: Hunt = data.hunt;
                          const versionChanged = updated.version !== selected.version;
                          setHunts((items) =>
                            items.map((item) => (item.id === updated.id ? updated : item)),
                          );
                          setSelected(updated);
                          setEditName(updated.name || "");
                          setEditNotifyEmail(updated.notifyEmail || "");
                          setEditWebhookUrl(updated.webhookUrl || "");
                          setEditEnabled(updated.enabled);
                          if ("rules" in updated.criteria && Array.isArray(updated.criteria.rules)) {
                            setEditMode(updated.criteria.mode ?? "all");
                            setEditRules(updated.criteria.rules.map((rule) => ({ ...rule })));
                          }
                          if (versionChanged) {
                            setEvaluation(null);
                          }
                          setEditing(false);
                          setMessage(
                            versionChanged
                              ? "Hunt updated. Run Check for changes to rebuild the baseline for the new criteria."
                              : "Hunt updated.",
                          );
                        });
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Edit hunt</h3>
                        <label className="inline-flex items-center gap-2 text-xs font-semibold">
                          <input
                            type="checkbox"
                            checked={editEnabled}
                            onChange={(event) => setEditEnabled(event.target.checked)}
                          />
                          Enabled
                        </label>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block text-xs font-semibold">
                          Name
                          <input
                            required
                            maxLength={80}
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            className={`${inputClass} mt-1.5`}
                          />
                        </label>
                        <label className="block text-xs font-semibold">
                          Email alerts
                          <input
                            type="email"
                            placeholder="you@example.com"
                            maxLength={254}
                            value={editNotifyEmail}
                            onChange={(event) => setEditNotifyEmail(event.target.value)}
                            className={`${inputClass} mt-1.5`}
                          />
                        </label>
                      </div>
                      <label className="mt-3 block text-xs font-semibold">
                        Webhook URL
                        <input
                          type="url"
                          placeholder="https://example.com/api/webhooks/property-alerts"
                          maxLength={256}
                          value={editWebhookUrl}
                          onChange={(event) => setEditWebhookUrl(event.target.value)}
                          className={`${inputClass} mt-1.5`}
                        />
                      </label>
                      {"discoveryFilters" in selected.criteria ? (
                        <p className="mt-3 text-xs text-ink-3">
                          Criteria for this hunt come from saved Discover filters. You can update its name, status, or alert destinations here.
                        </p>
                      ) : (
                        <>
                          <label className="mt-3 block text-xs font-semibold">
                            Match
                            <select
                              value={editMode}
                              onChange={(event) => setEditMode(event.target.value as "all" | "any")}
                              className={`${inputClass} mt-1.5`}
                            >
                              <option value="all">Every criterion</option>
                              <option value="any">Any criterion</option>
                            </select>
                          </label>
                          <RuleBuilderFields
                            rules={editRules}
                            onChange={setEditRules}
                            idPrefix="Edit"
                          />
                        </>
                      )}
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                          className="rounded-lg border border-line-strong bg-card px-3 py-2 text-xs font-semibold text-ink-2"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Save changes
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {"discoveryFilters" in selected.criteria
                      ? Object.entries(selected.criteria.discoveryFilters ?? {}).map(([key, value]) => (
                        <span key={key} className="rounded-full bg-line px-3 py-1.5 text-label">
                          {discoveryFilterLabels[key] || key.replaceAll("_", " ")}: {value === "unknown" ? "Unknown" : display(value)}
                        </span>
                      ))
                      : selected.criteria.rules.map((rule, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-line px-3 py-1.5 text-label"
                      >
                        {label(rule.field)} {rule.operator.replaceAll("_", " ")}{" "}
                        {!["known", "unknown"].includes(rule.operator) &&
                          display(rule.value)}
                      </span>
                    ))}
                    {"discoveryFilters" in selected.criteria && !Object.keys(selected.criteria.discoveryFilters ?? {}).length && (
                      <span className="rounded-full bg-line px-3 py-1.5 text-label">All discovered properties</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const data = await api(`/${selected.id}`, "PATCH", {
                          enabled: !selected.enabled,
                        });
                        setSelected(data.hunt);
                        setEditEnabled(data.hunt.enabled);
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
                  <p className="mt-3 text-xs leading-5 text-ink-3">
                    Enabled hunts also run automatically whenever new property updates are collected.
                  </p>
                  {evaluation ? (
                    <>
                      <div className="mt-6 grid grid-cols-3 gap-3">
                        {[
                          ["match", "Matches"],
                          ["unknown", "Missing details"],
                          ["noMatch", "Did not match"],
                        ].map(([key, title]) => (
                          <div
                            key={key}
                            className="rounded-control bg-paper p-4"
                          >
                            <p className="text-2xl font-semibold">
                              {evaluation.counts[key] || 0}
                            </p>
                            <p className="mt-1 text-label text-ink-3">
                              {title}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs leading-5 text-ink-3">
                        {evaluation.counts.accepted} verified listings checked.{" "}
                        {evaluation.counts.rejected || 0} incomplete records skipped.{" "}
                        {evaluation.counts.notObserved || 0} previously matched
                        listings were not in the latest update.
                      </p>
                      {evaluation.rankingNote ? (
                        <p className="mt-2 text-label leading-5 text-ink-3">
                          {evaluation.rankingNote}
                        </p>
                      ) : null}
                      {/* A hunt whose criterion can never be satisfied is not a
                          hunt that found nothing. Without this the user sees an
                          ordinary empty result for a rule that no record could
                          ever have satisfied. */}
                      {evaluation.unsatisfiableCriteria?.length ? (
                        <div
                          role="status"
                          data-testid="hunt-unsatisfiable-notice"
                          className="mt-3 rounded-lg border border-catch/30 bg-catch-wash p-3 text-xs leading-5 text-catch-ink"
                        >
                          <p className="font-bold">This hunt cannot match as written.</p>
                          <p className="mt-1">
                            {evaluation.unsatisfiableCriteriaNote}
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-4">
                            {evaluation.unsatisfiableCriteria.map((criterion) => (
                              <li key={`${criterion.field}-${criterion.operator}`}>
                                {criterion.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <label className="mt-6 flex items-center justify-between gap-3 text-sm font-semibold">
                        Inspect results
                        <select
                          aria-label="Hunt result filter"
                          className="rounded-lg border border-line-strong px-3 py-2 text-xs font-normal"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                        >
                          <option value="match">Matches</option>
                          <option value="unknown">Missing details</option>
                          <option value="no_match">Did not match</option>
                          <option value="all">All returned results</option>
                        </select>
                      </label>
                      <div className="mt-4 space-y-3">
                        {results.map((result) => (
                          <article
                            key={result.listingId}
                            className="rounded-control border border-line p-4"
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
                              <div className="flex flex-wrap items-center gap-1.5">
                                {result.status === "match" && result.relevance ? (
                                  <span
                                    title={result.relevance.note || "Evidence-backed triage rank for this hunt match."}
                                    className={`rounded-control px-2 py-1 text-label font-semibold ${
                                      result.relevance.band === "high"
                                        ? "bg-ink text-white"
                                        : result.relevance.band === "medium"
                                          ? "bg-line text-ink"
                                          : "bg-paper text-ink-2"
                                    }`}
                                  >
                                    Rank {result.relevance.rank}/100
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-control px-2 py-1 text-label font-semibold ${result.status === "match" ? "bg-line" : result.status === "unknown" ? "bg-catch-wash text-catch-ink" : "bg-paper text-ink-3"}`}
                                >
                                  {result.status === "no_match"
                                    ? "did not match"
                                    : result.status === "unknown"
                                      ? "missing details"
                                      : result.status.replaceAll("_", " ")}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-ink-3">
                              {sourceDisplayText(result.sourceId)} · Updated{" "}
                              {new Date(result.observedAt).toLocaleString()}
                            </p>
                            {result.status === "match" && result.relevance ? (
                              <p className="mt-2 text-label leading-5 text-ink-3">
                                Triage rank uses criterion closeness, listing detail
                                {result.relevance.researchQualityScore != null
                                  ? ` (${result.relevance.researchQualityScore}/100)`
                                  : ""}
                                {result.relevance.urgency
                                  ? `, sale timing (${result.relevance.urgency.replaceAll("_", " ")})`
                                  : ""}
                                {result.relevance.dealScoreBand
                                  ? `, and Deal Score band (${result.relevance.dealScoreBand})`
                                  : ""}
                                . Not an appraisal or legal verification.
                              </p>
                            ) : null}
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-semibold">
                                Why this result
                              </summary>
                              <div className="mt-3 space-y-3">
                                {result.relevance?.factors?.length ? (
                                  <div className="rounded-lg bg-paper p-3">
                                    <p className="text-label font-bold uppercase tracking-wider text-ink-3">
                                      Ranking factors
                                    </p>
                                    <ul className="mt-2 space-y-1.5">
                                      {result.relevance.factors.map((factor) => (
                                        <li key={factor.factor} className="text-label leading-4 text-ink-2">
                                          <span className="font-semibold">{factor.factor.replaceAll("_", " ")}</span>
                                          {" · "}
                                          {factor.detail}
                                          {" "}
                                          <span className="text-ink-3">({factor.weight})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {result.clauseResults.map((clause, index) => (
                                  <div
                                    key={index}
                                    className="border-l-2 border-line pl-3"
                                  >
                                    <p className="text-xs font-semibold">
                                      {label(clause.field)} ·{" "}
                                      {clause.status === "no_match"
                                        ? "did not match"
                                        : clause.status === "unknown"
                                          ? "missing details"
                                          : clause.status.replaceAll("_", " ")}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-ink-3">
                                      {sourceDisplayText(clause.reason)}
                                    </p>
                                    <p className="mt-1 text-label text-ink-3">
                                      Recorded value: {display(clause.actual)} ·{" "}
                                      {evidenceLabels[clause.evidenceClass] ||
                                        clause.evidenceClass.replaceAll("_", " ")}
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
                                View property dossier <ArrowRight size={12} />
                              </Link>
                              {result.sourceUrl ? (
                                <a
                                  href={result.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs underline"
                                >
                                  Official listing <ExternalLink size={12} />
                                </a>
                              ) : null}
                            </div>
                          </article>
                        ))}
                        {!results.length && (
                          <p className="rounded-control bg-paper p-5 text-sm leading-6 text-ink-3">
                            No properties in this category yet. Try switching the
                            result filter above or broadening your criteria.
                          </p>
                        )}
                      </div>
                      {evaluation.resultsTruncated && (
                        <p className="mt-3 text-xs text-ink-2">
                          Showing the top results. Counts cover all verified
                          listings; narrow this hunt to inspect more matches.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="mt-6 rounded-control bg-paper p-6">
                      <h3 className="font-semibold">Run your first check</h3>
                      <p className="mt-2 text-sm leading-6 text-ink-3">
                        Run this hunt once to save a baseline. Later runs will
                        highlight newly listed properties, price or date changes,
                        and listings that no longer qualify.
                      </p>
                    </div>
                  )}
                  <div className="mt-8 border-t border-line pt-6">
                    <h3 className="text-lg font-semibold">What changed</h3>
                    {eventsError && (
                      <p
                        role="alert"
                        className="mt-3 rounded-lg bg-catch-wash p-3 text-xs leading-5 text-catch-ink"
                      >
                        {eventsError}
                      </p>
                    )}
                    {events.length ? (
                      <div className="mt-4 space-y-3">
                        {events.slice(0, 30).map((event) => (
                          <div
                            key={event.id}
                            className="rounded-control bg-paper p-4"
                          >
                            <p className="text-xs font-semibold">
                              {eventTypeLabels[event.type] || event.type.replaceAll("_", " ")} ·{" "}
                              {event.listingId ? (
                                <Link href={`/listings/${encodeURIComponent(event.listingId)}?returnTo=${encodeURIComponent("/hunts")}`} className="underline underline-offset-2 hover:text-ink-2">
                                  {sourceDisplayText(event.address || event.listingId)}
                                </Link>
                              ) : (
                                sourceDisplayText(event.address || event.listingId)
                              )}
                            </p>
                            <p className="mt-2 text-xs leading-6 text-ink-3">
                              {sourceDisplayText(event.message)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-ink-3">
                        No change events yet. Run your first check to set a
                        baseline; future runs will record new matches and
                        updates here.
                      </p>
                    )}
                    <p className="mt-4 text-xs leading-5 text-ink-3">
                      Subscribed accounts receive alert digests when collection updates match active hunts; run checks anytime with Check for changes.
                    </p>
                  </div>
                </>
              ) : (
                <div className="py-10">
                  <Crosshair size={34} />
                  <h2 className="mt-4 text-2xl font-semibold">
                    Make the search yours.
                  </h2>
                  <p className="mt-3 max-w-md text-sm leading-7 text-ink-3">
                    Create a hunt or open a saved one. Every match shows the
                    listing details and why each criterion matched.
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
