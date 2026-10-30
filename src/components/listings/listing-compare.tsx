"use client";

import * as React from "react";
import Link from "next/link";
import { displayMoney } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import {
  COMPARE_LIMIT,
  makeCompareTarget,
  normalizeCompareIds,
  removeCompareId,
  toggleCompareId,
} from "@/lib/compare-selection.js";

const STORAGE_KEY = "pp_compare_ids";
const CHANGE_EVENT = "pp-compare";

type CompareRow = {
  id: string | null;
  sqft: number | null;
  year: number | null;
  openingBid: number | null;
  mid: number | null;
  estLow: number | null;
  estHigh: number | null;
  dealScore: number | null;
  lotSize: number | null;
  discount: number | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  propType: string | null;
  source: string | null;
  occupancy: string | null;
  status: string | null;
};

type Dimension = {
  values: Array<number | null>;
  deltas: Array<number | null>;
  bestIndex: number;
};

export type ComparePayload = {
  schema: string;
  targetId: string | null;
  count: number;
  rows: CompareRow[];
  deltas: Record<string, Dimension>;
  winnerByField: Record<string, string | null>;
  reason: string | null;
};

type FieldKind = "money" | "number" | "percent" | "text";

const FIELDS: Array<{ key: keyof CompareRow; label: string; kind: FieldKind }> = [
  { key: "openingBid", label: "Opening amount", kind: "money" },
  { key: "discount", label: "Opening vs midpoint", kind: "percent" },
  { key: "dealScore", label: "Deal score", kind: "number" },
  { key: "sqft", label: "Interior sq ft", kind: "number" },
  { key: "year", label: "Year built", kind: "number" },
  { key: "lotSize", label: "Lot size", kind: "number" },
  { key: "mid", label: "Valuation midpoint", kind: "money" },
  { key: "estLow", label: "Estimate low", kind: "money" },
  { key: "estHigh", label: "Estimate high", kind: "money" },
  { key: "propType", label: "Type", kind: "text" },
  { key: "occupancy", label: "Occupancy", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "source", label: "Source", kind: "text" },
  { key: "city", label: "City", kind: "text" },
  { key: "state", label: "State", kind: "text" },
  { key: "zip", label: "ZIP", kind: "text" },
];

function readStored(): string[] {
  try {
    return normalizeCompareIds(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function publish(ids: string[]) {
  const next = normalizeCompareIds(ids);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* sessionStorage can be unavailable; the in-memory list still drives this tab */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  return next;
}

export function useCompareSelection() {
  const [ids, setIds] = React.useState<string[]>([]);
  const idsRef = React.useRef<string[]>([]);
  const hydrated = React.useRef(false);

  const apply = React.useCallback((next: string[]) => {
    const normalized = normalizeCompareIds(next);
    idsRef.current = normalized;
    hydrated.current = true;
    setIds(normalized);
    return normalized;
  }, []);

  React.useEffect(() => {
    const sync = (event: Event) => {
      const next = event instanceof CustomEvent && Array.isArray(event.detail)
        ? event.detail
        : readStored();
      apply(next);
    };
    sync(new Event("storage"));
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [apply]);

  const current = React.useCallback(() => {
    if (!hydrated.current) apply(readStored());
    return idsRef.current;
  }, [apply]);
  const commit = React.useCallback((next: string[]) => {
    apply(publish(next));
  }, [apply]);
  const toggle = React.useCallback((id: string) => {
    commit(toggleCompareId(current(), id));
  }, [commit, current]);
  const remove = React.useCallback((id: string) => {
    commit(removeCompareId(current(), id));
  }, [commit, current]);
  const makeTarget = React.useCallback((id: string) => {
    commit(makeCompareTarget(current(), id));
  }, [commit, current]);
  const clear = React.useCallback(() => {
    commit([]);
  }, [commit]);

  return { ids, toggle, remove, makeTarget, clear, full: ids.length >= COMPARE_LIMIT };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function showValue(value: unknown, kind: FieldKind): string {
  if (kind === "text") {
    if (typeof value !== "string" || !value.trim()) return "—";
    return value.trim();
  }
  const numeric = finite(value);
  if (numeric === null) return "—";
  if (kind === "money") return displayMoney(numeric);
  if (kind === "percent") return `${(numeric * 100).toFixed(1)}%`;
  return numeric.toLocaleString();
}

function showDelta(value: number | null, kind: FieldKind): string | null {
  if (value === null || !Number.isFinite(value) || kind === "text") return null;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const magnitude = Math.abs(value);
  if (kind === "money") return `${sign}${displayMoney(magnitude)}`;
  if (kind === "percent") return `${sign}${(magnitude * 100).toFixed(1)} pt`;
  return `${sign}${magnitude.toLocaleString()}`;
}

function rowLabel(row: CompareRow, labels: Record<string, string>): string {
  const id = row.id || "";
  if (id && labels[id]) return labels[id];
  const place = [row.city, row.state].filter((part) => typeof part === "string" && part.trim()).join(", ");
  return place || id || "Listing";
}

export function CompareTray({
  ids,
  labels = {},
  onRemove,
  onMakeTarget,
  onClear,
}: {
  ids: string[];
  labels?: Record<string, string>;
  onRemove: (id: string) => void;
  onMakeTarget: (id: string) => void;
  onClear: () => void;
}) {
  const [payload, setPayload] = React.useState<ComparePayload | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const key = ids.join("\0");

  React.useEffect(() => {
    if (ids.length < 2) {
      setPayload(null);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
    void fetch("/api/listings/compare" + "?" + query, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const missing = Array.isArray(body?.missing) ? body.missing.filter((id: unknown): id is string => typeof id === "string") : [];
          const code = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
          throw new Error(missing.length ? `${code}: ${missing.join(", ")}` : code);
        }
        if (!body || body.schema !== "property-crawl.compare/v1" || !Array.isArray(body.rows)) {
          throw new Error("Comparison response was not property-crawl.compare/v1.");
        }
        setPayload(body as ComparePayload);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(caught instanceof Error ? caught.message : "Comparison could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, ids]);

  if (ids.length === 0) return null;

  const rows = payload?.rows ?? [];

  return (
    <section aria-label="Listing comparison" data-testid="listing-compare" className="mt-5 rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Compare</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">The first listing is the target. Deltas are signed against it. A blank cell was not published and is not treated as zero. At most {COMPARE_LIMIT} listings.</p>
        </div>
        <button type="button" onClick={onClear} className="rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-paper">Clear</button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {ids.map((id, index) => (
          <li key={id} className="flex items-center gap-1 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-xs">
            <span className="max-w-[16rem] truncate font-semibold text-ink">{labels[id] || id}</span>
            <span className="text-ink-3">{index === 0 ? "Target" : `#${index + 1}`}</span>
            {index > 0 ? <button type="button" onClick={() => onMakeTarget(id)} className="rounded-full px-2 py-1 font-semibold text-ink-2 hover:bg-card">Make target</button> : null}
            <button type="button" onClick={() => onRemove(id)} aria-label={`Remove ${labels[id] || id} from compare`} className="rounded-full px-2 py-1 font-semibold text-ink-2 hover:bg-card">Remove</button>
          </li>
        ))}
      </ul>
      {ids.length < 2 ? <p className="mt-3 text-sm text-ink-3">Select one more listing to compare.</p> : null}
      {loading ? <p role="status" className="mt-3 text-sm text-ink-3">Loading comparison…</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-catch-wash p-3 text-sm text-catch-ink">{error}</p> : null}
      {rows.length >= 2 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <caption className="sr-only">Side-by-side listing comparison. The first column is the target.</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 text-xs font-semibold text-ink-3">Field</th>
                {rows.map((row, index) => {
                  const id = row.id || "";
                  const label = rowLabel(row, labels);
                  return (
                    <th key={id || index} scope="col" className="min-w-[10rem] py-2 pr-4 align-bottom">
                      {id ? <Link href={`/listings/${encodeURIComponent(id)}`} className="font-semibold text-ink underline-offset-2 hover:underline">{label}</Link> : <span className="font-semibold">{label}</span>}
                      <span className="mt-1 block text-[11px] font-medium text-ink-3">{index === 0 ? "Target" : "Compared"}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((field) => (
                <tr key={field.key} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 text-xs font-semibold text-ink-3">{field.label}</th>
                  {rows.map((row, index) => {
                    const raw = row[field.key];
                    const winnerId = payload?.winnerByField?.[field.key];
                    const winner = field.kind !== "text" && winnerId != null && winnerId === row.id;
                    const delta = index === 0 ? null : finite(payload?.deltas?.[field.key]?.deltas?.[index - 1]);
                    const deltaLabel = showDelta(delta, field.kind);
                    const text = field.kind === "text" && field.key === "source" && typeof raw === "string" && raw.trim()
                      ? sourceDisplayText(raw)
                      : showValue(raw, field.kind);
                    return (
                      <td key={`${row.id || index}-${field.key}`} className="py-2 pr-4 align-top">
                        <span className="font-semibold text-ink">{text}</span>
                        {winner ? <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-2">Best</span> : null}
                        {deltaLabel ? <span className="mt-0.5 block text-[11px] text-ink-3">vs target {deltaLabel}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function ListingCompareToggle({ listingId, className = "" }: { listingId: string; className?: string }) {
  const compare = useCompareSelection();
  const selected = compare.ids.includes(listingId);
  const disabled = compare.full && !selected;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => compare.toggle(listingId)}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink-2 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {selected ? "In compare" : disabled ? "Compare is full" : "Add to compare"}
    </button>
  );
}

export function ListingCompare({ listingId, label }: { listingId: string; label: string }) {
  const compare = useCompareSelection();
  const labels = React.useMemo(() => ({ [listingId]: label }), [listingId, label]);
  return (
    <div className="space-y-3">
      <ListingCompareToggle listingId={listingId} />
      <CompareTray ids={compare.ids} labels={{ ...labels }} onRemove={compare.remove} onMakeTarget={compare.makeTarget} onClear={compare.clear} />
    </div>
  );
}
