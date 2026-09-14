import type { PropertyListing } from "@/components/terminal/property-data";

/**
 * Window (in milliseconds) within which a listing counts as "new" for the
 * workbench chip. Deliberately stricter than the server-side `triage.isNew`
 * (48h) so the chip surfaces only the freshest observations.
 */
export const NEW_OBSERVATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TriageChipKey = "isNew" | "priceDropped" | "hasDocs" | "occupancyKnown";

export type TriageChipTone = "green" | "amber" | "blue" | "slate";

export type TriageChipDescriptor = {
  key: TriageChipKey;
  label: string;
  tone: TriageChipTone;
  /** Lucide icon name; resolved by the renderer. */
  icon: "Sparkles" | "TrendingDown" | "FileText" | "Home";
};

const CHIP_TONE_CLASSES: Record<TriageChipTone, string> = {
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  blue: "bg-blue-50 text-blue-800",
  slate: "bg-slate-100 text-slate-700",
};

export function chipToneClasses(tone: TriageChipTone): string {
  return CHIP_TONE_CLASSES[tone];
}

function isObservedWithinWindow(
  observedAt: string | null | undefined,
  now: number,
  windowMs: number,
): boolean {
  if (typeof observedAt !== "string" || !observedAt.trim()) return false;
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp <= windowMs;
}

/**
 * Pure, deterministic chip computation. Extracted so it can be exercised by
 * unit tests without spinning up a React renderer.
 *
 * The four flags map onto per-listing triage metadata as follows:
 *   - isNew          → sourceObservedAt within last 24 hours (client clock)
 *   - priceDropped   → triage.priceDropped
 *   - hasDocs        → triage.hasDocs
 *   - occupancyKnown → triage.occupancyKnown
 */
export function computeTriageChips(
  listing: Pick<PropertyListing, "triage" | "sourceObservedAt">,
  options: { now?: number } = {},
): TriageChipDescriptor[] {
  const chips: TriageChipDescriptor[] = [];
  const triage = listing.triage;

  if (isObservedWithinWindow(listing.sourceObservedAt, options.now ?? Date.now(), NEW_OBSERVATION_WINDOW_MS)) {
    chips.push({ key: "isNew", label: "New", tone: "green", icon: "Sparkles" });
  }
  if (triage?.priceDropped) {
    chips.push({ key: "priceDropped", label: "Price cut", tone: "amber", icon: "TrendingDown" });
  }
  if (triage?.hasDocs) {
    chips.push({ key: "hasDocs", label: "Docs", tone: "blue", icon: "FileText" });
  }
  if (triage?.occupancyKnown) {
    chips.push({ key: "occupancyKnown", label: "Occupancy known", tone: "slate", icon: "Home" });
  }

  return chips;
}