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
import type { Messages } from "@/lib/i18n/messages";
import { formatLocaleDate, formatLocaleNumber } from "@/lib/i18n/translator";
import { compileHuntQuery, formatIsoDate } from "@/lib/hunt-query";

type SavedHuntsMessages = Messages["savedHunts"];
type FieldKey = keyof SavedHuntsMessages["fields"];
type OperatorKey = keyof SavedHuntsMessages["operators"];
type FieldKind = "text" | "number" | "date";

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

const fieldSpecs: readonly [FieldKey, FieldKind][] = [
  ["state", "text"],
  ["source", "text"],
  ["county", "text"],
  ["propType", "text"],
  ["status", "text"],
  ["auctionProgram", "text"],
  ["lifecycleStatus", "text"],
  ["occupancy", "text"],
  ["sourceObservedAt", "date"],
  ["openingBid", "number"],
  ["sqft", "number"],
  ["saleDate", "date"],
];

const operatorSpecs: Record<FieldKind, readonly [string, OperatorKey][]> = {
  text: [
    ["eq", "text_eq"],
    ["neq", "text_neq"],
    ["known", "text_known"],
    ["unknown", "text_unknown"],
  ],
  number: [
    ["lte", "number_lte"],
    ["gte", "number_gte"],
    ["eq", "number_eq"],
    ["known", "number_known"],
    ["unknown", "number_unknown"],
  ],
  date: [
    ["on_or_after", "date_on_or_after"],
    ["on_or_before", "date_on_or_before"],
    ["known", "date_known"],
    ["unknown", "date_unknown"],
  ],
};

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match,
  );
}

const fieldType = (field: string): FieldKind =>
  fieldSpecs.find(([name]) => name === field)?.[1] || "text";

const fieldLabel = (value: string, sh: SavedHuntsMessages) =>
  (sh.fields as Record<string, string>)[value] || value.replaceAll("_", " ");

const display = (value: unknown, sh: SavedHuntsMessages) =>
  value === null || value === undefined
    ? sh.unknownValue
    : typeof value === "object"
      ? sourceDisplayText(JSON.stringify(value))
      : sourceDisplayText(String(value));

const statusText = (status: string, sh: SavedHuntsMessages) =>
  status === "no_match"
    ? sh.statusDidNotMatch
    : status === "unknown"
      ? sh.statusMissingDetails
      : status === "match"
        ? sh.statusMatch
        : status.replaceAll("_", " ");

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
  nameKey: keyof SavedHuntsMessages["templates"];
  descKey: keyof SavedHuntsMessages["templates"];
  rules: () => Rule[];
}[] = [
  {
    name: "Published bid moved below my ceiling",
    nameKey: "bidCeilingName",
    descKey: "bidCeilingDesc",
    rules: () => [{ field: "openingBid", operator: "lte", value: 150000 }],
  },
  {
    name: "Rescheduled sale",
    nameKey: "rescheduledName",
    descKey: "rescheduledDesc",
    rules: () => [{ field: "saleDate", operator: "known" }],
  },
  {
    name: "Program and sale-stage review",
    nameKey: "programStageName",
    descKey: "programStageDesc",
    rules: () => [
      { field: "auctionProgram", operator: "known" },
      { field: "lifecycleStatus", operator: "known" },
    ],
  },
  {
    name: "Approaching published sale",
    nameKey: "approachingSaleName",
    descKey: "approachingSaleDesc",
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
    nameKey: "sqftReviewName",
    descKey: "sqftReviewDesc",
    rules: () => [{ field: "sqft", operator: "known" }],
  },
  {
    name: "Alachua Second Chance",
    nameKey: "alachuaName",
    descKey: "alachuaDesc",
    rules: () => [
      { field: "county", operator: "eq", value: "Alachua" },
      { field: "status", operator: "eq", value: "available_for_public" },
    ],
  },
];

function RuleBuilderFields({
  rules,
  onChange,
  modePrefix,
}: {
  rules: Rule[];
  onChange: (next: Rule[]) => void;
  modePrefix: "create" | "edit";
}) {
  const { messages } = useLocale();
  const sh = messages.savedHunts;
  const prefix = modePrefix === "create" ? sh.prefixCreate : sh.prefixEdit;
  const prefixLower = modePrefix === "create" ? sh.prefixCreateLower : sh.prefixEditLower;

  function updateRule(index: number, change: Partial<Rule>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));
  }

  return (
    <>
      <div className="mt-4 space-y-3">
        {rules.map((rule, index) => {
          const type = fieldType(rule.field);
          const criterionIndex = index + 1;
          return (
            <fieldset
              key={`${modePrefix}-${index}`}
              className="space-y-2 rounded-control border border-line p-3"
            >
              <legend className="px-1 text-label font-semibold">
                {fmt(sh.criterionLegend, { index: criterionIndex })}
              </legend>
              <div className="flex gap-2">
                <select
                  aria-label={fmt(sh.criterionFieldAria, { prefix, index: criterionIndex })}
                  value={rule.field}
                  onChange={(event) => {
                    const nextType = fieldType(event.target.value);
                    updateRule(index, {
                      field: event.target.value,
                      operator: operatorSpecs[nextType][0][0],
                      value: nextType === "number" ? 100000 : "",
                    });
                  }}
                  className={inputClass}
                >
                  {fieldSpecs.map(([field]) => (
                    <option key={field} value={field}>
                      {sh.fields[field]}
                    </option>
                  ))}
                </select>
                {rules.length > 1 && (
                  <button
                    type="button"
                    aria-label={fmt(sh.removeCriterionAria, { prefix: prefixLower, index: criterionIndex })}
                    onClick={() => onChange(rules.filter((_, i) => i !== index))}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <select
                aria-label={fmt(sh.criterionOperatorAria, { prefix, index: criterionIndex })}
                value={rule.operator}
                onChange={(event) =>
                  updateRule(index, { operator: event.target.value })
                }
                className={inputClass}
              >
                {operatorSpecs[type].map(([operator, opKey]) => (
                  <option key={operator} value={operator}>
                    {sh.operators[opKey]}
                  </option>
                ))}
              </select>
              {!["known", "unknown"].includes(rule.operator) && (
                <input
                  aria-label={fmt(sh.criterionValueAria, { prefix, index: criterionIndex })}
                  required
                  type={type}
                  step={type === "number" ? "any" : undefined}
                  value={rule.value ?? ""}
                  placeholder={
                    rule.field === "source"
                      ? sh.placeholderSource
                      : rule.field === "state"
                        ? sh.placeholderState
                        : sh.placeholderValue
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
        <Plus size={14} /> {sh.addCriterion}
      </button>
    </>
  );
}

export function SavedHunts() {
  const { locale, messages: m } = useLocale();
  const sh = m.savedHunts;
  const session = useWorkspaceSession();
  const [connected, setConnected] = useState(false);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [selected, setSelected] = useState<Hunt | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [inbox, setInbox] = useState<(Event & { huntName: string })[]>([]);
  const [inboxError, setInboxError] = useState("");
  const [name, setName] = useState(sh.defaultHuntName);
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
  const [plainQuery, setPlainQuery] = useState(sh.defaultPlainQuery);
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
      throw new Error(sh.signInRequiredError);
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
      throw new Error(
        data.details?.[0] ||
          data.error ||
          fmt(sh.huntHttpError, { status: response.status }),
      );
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
      setInboxError(sh.inboxLoadAllFailed);
    } else if (failedHunts.length > 0) {
      const names = failedHunts.slice(0, 3).join(", ");
      setInboxError(
        failedHunts.length > 3
          ? fmt(sh.inboxLoadSomeFailedMore, { names, more: failedHunts.length - 3 })
          : fmt(sh.inboxLoadSomeFailed, { names }),
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
        caught instanceof Error ? caught.message : sh.operationFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function openHunt(hunt: Hunt) {
    const detail = await api(`/${hunt.id}`);
    applySelectedHunt(detail.hunt, detail.recentEvents || []);
  }

  const pillOperator = (field: string, operator: string) => {
    if (locale === "en") return operator.replaceAll("_", " ");
    const kind = fieldType(field);
    const key = `${kind}_${operator}` as OperatorKey;
    return sh.operators[key] || operator.replaceAll("_", " ");
  };

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
        {(session.loading || session.memberTools) && (
          <div className="mt-8 flex max-w-xl items-center justify-between gap-4 rounded-card border border-line bg-card p-5">
            <div>
              <p className="text-sm font-semibold">
                {session.member?.entitled && !session.authenticated
                  ? fmt(sh.yourHuntsWithEmail, { email: session.member.email })
                  : sh.huntsCardTitle}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-3">
                {session.loading ? sh.checkingSession : sh.huntsActiveDesc}
              </p>
            </div>
            {session.loading ? null : (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await refreshAll();
                    setMessage(sh.refreshedToast);
                  })
                }
                className="shrink-0 rounded-lg border border-line-strong px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {m.workspacePages.huntsRefreshBtn}
              </button>
            )}
          </div>
        )}
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
                ? sh.membershipRequiredHeading
                : sh.signInManageHeading}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-3">
              {session.member
                ? sh.membershipRequiredBody
                : sh.signInManageBody}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {session.member ? (
                <>
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-2"
                  >
                    {sh.upgradeMembership} <ArrowRight size={15} />
                  </Link>
                  <Link
                    href="/account"
                    className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-card"
                  >
                    {sh.accountBtn}
                  </Link>
                  <Link
                    href="/listings"
                    className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-card"
                  >
                    {sh.browseListingsFree}
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
                    {sh.viewPlans}
                  </Link>
                  <button
                    type="button"
                    onClick={session.requestUnlock}
                    className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-paper px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-card"
                  >
                    {m.common.unlock}
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        {session.memberTools && !connected && (
          <section className="mt-8 rounded-card border border-line bg-card p-6">
            {error ? (
              <>
                <h2 className="text-lg font-semibold">{sh.loadFailedHeading}</h2>
                <p className="mt-2 text-sm text-ink-3">{error}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => { await refreshAll(); })}
                  className="mt-4 rounded-control bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {sh.retryBtn}
                </button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-3">
                <Loader2 size={16} className="animate-spin" /> {sh.loadingSavedHunts}
              </p>
            )}
          </section>
        )}
        {connected && (
          <section
            className="mt-6 rounded-card border border-line bg-paper p-5"
            aria-label={sh.inboxAria}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink-2">
                  {sh.inboxEyebrow}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {sh.inboxHeading}
                </h2>
              </div>
              <span className="rounded-full bg-card px-3 py-1 text-xs font-bold text-ink">
                {fmt(sh.inboxEventsCount, { count: formatLocaleNumber(locale, inbox.length) })}
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
                      {event.huntName} · {(sh.eventTypeLabels as Record<string, string>)[event.type] || event.type.replaceAll("_", " ")} ·{" "}
                      {formatLocaleDate(locale, event.observedAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="mt-2 block text-xs text-ink-2">
                      {sourceDisplayText(event.message)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-3">
                {sh.inboxEmpty}
              </p>
            )}
          </section>
        )}
        {connected && (
          <section className="mt-7 rounded-card border border-line bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {sh.templateHeading}
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-3">
                  {sh.templateSub}
                </p>
              </div>
              <div className="flex max-w-xl flex-1 gap-2">
                <input
                  aria-label={sh.describeHuntAria}
                  value={plainQuery}
                  onChange={(event) => setPlainQuery(event.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => {
                    const compiled = compileHuntQuery(plainQuery);
                    if (compiled.criteria.rules.length) {
                      setName(fmt(sh.compiledHuntPrefix, { query: plainQuery.slice(0, 60) }));
                      setMode(compiled.criteria.mode);
                      setRules(compiled.criteria.rules);
                    }
                    setMissingDependencies(compiled.missingDependencies);
                    setQueryWarnings(compiled.warnings);
                    setMessage(
                      compiled.criteria.rules.length
                        ? compiled.warnings.length
                          ? sh.draftedWithWarningsToast
                          : sh.draftedToast
                        : sh.draftedNoMatchToast,
                    );
                  }}
                  className="shrink-0 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white"
                >
                  {sh.draftCriteriaBtn}
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
                {fmt(sh.unsupportedRequestNotice, { fields: missingDependencies.join("; ") })}
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {huntTemplates.map((template) => {
                const templateName = sh.templates[template.nameKey];
                const templateDesc = sh.templates[template.descKey];
                return (
                  <button
                    key={template.nameKey}
                    type="button"
                    onClick={() => {
                      setName(templateName);
                      setMode("all");
                      setRules(template.rules());
                      setMissingDependencies([]);
                      setQueryWarnings([]);
                      setMessage(fmt(sh.templateLoadedToast, { name: templateName }));
                    }}
                    className="rounded-control border border-line p-3 text-left hover:border-ink"
                  >
                    <span className="block text-xs font-semibold">
                      {templateName}
                    </span>
                    <span className="mt-1 block text-meta leading-4 text-ink-3">
                      {templateDesc}
                    </span>
                  </button>
                );
              })}
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
                    setMessage(sh.huntSavedToast);
                  });
                }}
              >
                <h2 className="text-lg font-semibold">{sh.buildHuntHeading}</h2>
                <label className="mt-4 block text-xs font-semibold">
                  {sh.nameLabel}
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={`${inputClass} mt-2`}
                  />
                </label>
                <label className="mt-4 block text-xs font-semibold">
                  {sh.emailAlertsLabel}{" "}
                  <span className="text-label font-normal text-ink-3">{sh.emailAlertsHint}</span>
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
                  {sh.webhookUrlLabel}{" "}
                  <span className="text-label font-normal text-ink-3">{sh.webhookUrlHint}</span>
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
                  {sh.matchModeLabel}
                  <select
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as "all" | "any")
                    }
                    className={`${inputClass} mt-2`}
                  >
                    <option value="all">{sh.everyCriterion}</option>
                    <option value="any">{sh.anyCriterion}</option>
                  </select>
                </label>
                <RuleBuilderFields
                  rules={rules}
                  onChange={setRules}
                  modePrefix="create"
                />
                <p className="mt-4 text-xs leading-5 text-ink-3">
                  {sh.observedRecordsNote}
                </p>
                <button
                  disabled={busy}
                  className="mt-5 w-full rounded-lg bg-ink px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {sh.saveHuntBtn}
                </button>
              </form>
              <div>
                <h2 className="mb-3 text-sm font-semibold">
                  {fmt(sh.yourHuntsCount, {
                    count: formatLocaleNumber(locale, hunts.length),
                    limit: formatLocaleNumber(locale, 20),
                  })}
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
                        {fmt(sh.versionStatusLine, {
                          version: hunt.version,
                          status: hunt.enabled ? sh.statusEnabled : sh.statusPaused,
                        })}
                      </span>
                    </button>
                  ))}
                  {!hunts.length && (
                    <p className="text-sm text-ink-3">
                      {sh.firstHuntHint}
                    </p>
                  )}
                </div>
              </div>
            </aside>
            <section
              ref={selectedSectionRef}
              tabIndex={-1}
              className="rounded-card border border-line bg-card p-5 sm:p-7"
              aria-label={sh.detailsSectionAria}
            >
              {selected ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-label font-bold uppercase tracking-widest text-ink">
                        {fmt(sh.savedHuntVersionEyebrow, { version: selected.version })}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {selected.name}
                      </h2>
                      {selected.notifyEmail && (
                        <p className="mt-1 flex items-center gap-1.5 font-mono text-label text-ink-2">
                          <span className="rounded bg-go-wash px-1.5 py-0.5 font-semibold text-go">{sh.emailBadge}</span>
                          <span className="truncate max-w-sm">{selected.notifyEmail}</span>
                        </p>
                      )}
                      {selected.webhookUrl && (
                        <p className="mt-1 flex items-center gap-1.5 font-mono text-label text-ink-2">
                          <span className="rounded bg-go-wash px-1.5 py-0.5 font-semibold text-go">{sh.webhookBadge}</span>
                          <span className="truncate max-w-sm">{selected.webhookUrl}</span>
                        </p>
                      )}
                      <p className="mt-2 text-xs text-ink-3">
                        {"discoveryFilters" in selected.criteria
                          ? sh.matchesSavedDiscover
                          : selected.criteria.mode === "all"
                            ? sh.everyCriterionMustMatch
                            : sh.anyCriterionMustMatch}
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
                                  : sh.refreshEventsFailed,
                              );
                            }
                            await loadInbox(hunts);
                            const base = data.evaluation.baselineCreated
                              ? sh.baselineSavedMsg
                              : sh.checkCompleteMsg;
                            const hook = data.evaluation.webhook;
                            const delivery = !hook || hook.delivery === "skipped"
                              ? ""
                              : hook.sent
                                ? sh.webhookAcceptedMsg
                                : hook.delivery === "refused"
                                  ? sh.webhookRefusedMsg
                                  : sh.webhookFailedMsg;
                            const mail = data.evaluation.email;
                            const mailNote = !mail || mail.delivery === "skipped"
                              ? ""
                              : mail.sent
                                ? sh.emailSentMsg
                                : mail.delivery === "local"
                                  ? sh.emailQueuedLocalMsg
                                  : sh.emailFailedMsg;
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
                        {sh.checkForChangesBtn}
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
                        <Pencil size={14} /> {editing ? sh.closeEditorBtn : sh.editBtn}
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
                          <Trash2 size={14} /> {sh.deleteBtn}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-lg border border-catch/40 bg-catch-wash px-2.5 py-1.5">
                          <span className="text-xs font-semibold text-catch-ink">
                            {sh.deleteConfirmPrompt}
                          </span>
                          {/* Renders "Confirm delete" in en via savedHunts.confirmDeleteBtn */}
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
                                setMessage(sh.huntDeletedToast);
                              })
                            }
                            className="rounded bg-ink px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {sh.confirmDeleteBtn}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDelete(false)}
                            className="rounded px-2 py-1.5 text-xs font-semibold text-ink-2 hover:bg-card"
                          >
                            {sh.cancelBtn}
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
                              ? sh.huntUpdatedRebuildToast
                              : sh.huntUpdatedToast,
                          );
                        });
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">{sh.editHuntHeading}</h3>
                        <label className="inline-flex items-center gap-2 text-xs font-semibold">
                          <input
                            type="checkbox"
                            checked={editEnabled}
                            onChange={(event) => setEditEnabled(event.target.checked)}
                          />
                          {sh.enabledLabel}
                        </label>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block text-xs font-semibold">
                          {sh.nameLabel}
                          <input
                            required
                            maxLength={80}
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            className={`${inputClass} mt-1.5`}
                          />
                        </label>
                        <label className="block text-xs font-semibold">
                          {sh.emailAlertsLabel}
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
                        {sh.webhookUrlLabel}
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
                          {sh.discoverCriteriaNote}
                        </p>
                      ) : (
                        <>
                          <label className="mt-3 block text-xs font-semibold">
                            {sh.matchModeLabel}
                            <select
                              value={editMode}
                              onChange={(event) => setEditMode(event.target.value as "all" | "any")}
                              className={`${inputClass} mt-1.5`}
                            >
                              <option value="all">{sh.everyCriterion}</option>
                              <option value="any">{sh.anyCriterion}</option>
                            </select>
                          </label>
                          <RuleBuilderFields
                            rules={editRules}
                            onChange={setEditRules}
                            modePrefix="edit"
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
                          {sh.cancelBtn}
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {sh.saveChangesBtn}
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {"discoveryFilters" in selected.criteria
                      ? Object.entries(selected.criteria.discoveryFilters ?? {}).map(([key, value]) => (
                        <span key={key} className="rounded-full bg-line px-3 py-1.5 text-label">
                          {(sh.discoveryFilterLabels as Record<string, string>)[key] || key.replaceAll("_", " ")}: {value === "unknown" ? sh.unknownValue : display(value, sh)}
                        </span>
                      ))
                      : selected.criteria.rules.map((rule, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-line px-3 py-1.5 text-label"
                      >
                        {fieldLabel(rule.field, sh)} {pillOperator(rule.field, rule.operator)}{" "}
                        {!["known", "unknown"].includes(rule.operator) &&
                          display(rule.value, sh)}
                      </span>
                    ))}
                    {"discoveryFilters" in selected.criteria && !Object.keys(selected.criteria.discoveryFilters ?? {}).length && (
                      <span className="rounded-full bg-line px-3 py-1.5 text-label">{sh.allDiscoveredProperties}</span>
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
                    {selected.enabled ? sh.pauseThisHunt : sh.enableThisHunt}
                  </button>
                  <p className="mt-3 text-xs leading-5 text-ink-3">
                    {sh.autoRunNote}
                  </p>
                  {evaluation ? (
                    <>
                      <div className="mt-6 grid grid-cols-3 gap-3">
                        {[
                          ["match", sh.summaryMatches],
                          ["unknown", sh.summaryMissingDetails],
                          ["noMatch", sh.summaryDidNotMatch],
                        ].map(([key, title]) => (
                          <div
                            key={key}
                            className="rounded-control bg-paper p-4"
                          >
                            <p className="text-2xl font-semibold">
                              {formatLocaleNumber(locale, evaluation.counts[key] || 0)}
                            </p>
                            <p className="mt-1 text-label text-ink-3">
                              {title}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs leading-5 text-ink-3">
                        {fmt(sh.evaluationCountsLine, {
                          accepted: formatLocaleNumber(locale, evaluation.counts.accepted),
                          rejected: formatLocaleNumber(locale, evaluation.counts.rejected || 0),
                          notObserved: formatLocaleNumber(locale, evaluation.counts.notObserved || 0),
                        })}
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
                          {/* Renders "This hunt cannot match as written." in en via savedHunts.unsatisfiableHeading */}
                          <p className="font-bold">{sh.unsatisfiableHeading}</p>
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
                        {sh.inspectResultsLabel}
                        <select
                          aria-label={sh.resultFilterAria}
                          className="rounded-lg border border-line-strong px-3 py-2 text-xs font-normal"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                        >
                          <option value="match">{sh.summaryMatches}</option>
                          <option value="unknown">{sh.summaryMissingDetails}</option>
                          <option value="no_match">{sh.summaryDidNotMatch}</option>
                          <option value="all">{sh.allReturnedResults}</option>
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
                                    title={result.relevance.note || sh.defaultRelevanceTitle}
                                    className={`rounded-control px-2 py-1 text-label font-semibold ${
                                      result.relevance.band === "high"
                                        ? "bg-ink text-white"
                                        : result.relevance.band === "medium"
                                          ? "bg-line text-ink"
                                          : "bg-paper text-ink-2"
                                    }`}
                                  >
                                    {fmt(sh.rankBadge, { rank: result.relevance.rank })}
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-control px-2 py-1 text-label font-semibold ${result.status === "match" ? "bg-line" : result.status === "unknown" ? "bg-catch-wash text-catch-ink" : "bg-paper text-ink-3"}`}
                                >
                                  {statusText(result.status, sh)}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-ink-3">
                              {fmt(sh.sourceUpdatedLine, {
                                source: sourceDisplayText(result.sourceId),
                                date: formatLocaleDate(locale, result.observedAt, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }),
                              })}
                            </p>
                            {result.status === "match" && result.relevance ? (
                              <p className="mt-2 text-label leading-5 text-ink-3">
                                {sh.triageRankLead}
                                {result.relevance.researchQualityScore != null
                                  ? ` (${result.relevance.researchQualityScore}/100)`
                                  : ""}
                                {result.relevance.urgency
                                  ? fmt(sh.triageRankUrgency, {
                                      urgency: result.relevance.urgency.replaceAll("_", " "),
                                    })
                                  : ""}
                                {result.relevance.dealScoreBand
                                  ? fmt(sh.triageRankDealBand, {
                                      band: result.relevance.dealScoreBand,
                                    })
                                  : ""}
                                {sh.triageRankDisclaimer}
                              </p>
                            ) : null}
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-semibold">
                                {sh.whyThisResult}
                              </summary>
                              <div className="mt-3 space-y-3">
                                {result.relevance?.factors?.length ? (
                                  <div className="rounded-lg bg-paper p-3">
                                    <p className="text-label font-bold uppercase tracking-wider text-ink-3">
                                      {sh.rankingFactorsHeading}
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
                                      {fieldLabel(clause.field, sh)} ·{" "}
                                      {statusText(clause.status, sh)}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-ink-3">
                                      {sourceDisplayText(clause.reason)}
                                    </p>
                                    <p className="mt-1 text-label text-ink-3">
                                      {fmt(sh.recordedValuePrefix, { value: display(clause.actual, sh) })} ·{" "}
                                      {(sh.evidenceLabels as Record<string, string>)[clause.evidenceClass] ||
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
                                {sh.viewPropertyDossier} <ArrowRight size={12} />
                              </Link>
                              {result.sourceUrl ? (
                                <a
                                  href={result.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs underline"
                                >
                                  {sh.officialListing} <ExternalLink size={12} />
                                </a>
                              ) : null}
                            </div>
                          </article>
                        ))}
                        {!results.length && (
                          <p className="rounded-control bg-paper p-5 text-sm leading-6 text-ink-3">
                            {sh.emptyCategoryResults}
                          </p>
                        )}
                      </div>
                      {evaluation.resultsTruncated && (
                        <p className="mt-3 text-xs text-ink-2">
                          {sh.resultsTruncatedNote}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="mt-6 rounded-control bg-paper p-6">
                      <h3 className="font-semibold">{sh.runFirstCheckHeading}</h3>
                      <p className="mt-2 text-sm leading-6 text-ink-3">
                        {sh.runFirstCheckBody}
                      </p>
                    </div>
                  )}
                  <div className="mt-8 border-t border-line pt-6">
                    <h3 className="text-lg font-semibold">{sh.whatChangedHeading}</h3>
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
                              {(sh.eventTypeLabels as Record<string, string>)[event.type] || event.type.replaceAll("_", " ")} ·{" "}
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
                        {sh.noChangeEventsBody}
                      </p>
                    )}
                    <p className="mt-4 text-xs leading-5 text-ink-3">
                      {sh.subscribedDigestNote}
                    </p>
                  </div>
                </>
              ) : (
                <div className="py-10">
                  <Crosshair size={34} />
                  <h2 className="mt-4 text-2xl font-semibold">
                    {sh.emptySelectHeading}
                  </h2>
                  <p className="mt-3 max-w-md text-sm leading-7 text-ink-3">
                    {sh.emptySelectBody}
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
