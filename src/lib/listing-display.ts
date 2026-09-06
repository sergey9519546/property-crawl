import { inspectImageUrl } from "@/lib/scrapers/media-policy";

export function knownNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function positiveNumber(value: unknown): number | null {
  const numeric = knownNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

export function displayMoney(value: unknown, fallback = "Not published") {
  const numeric = knownNumber(value);
  return numeric === null ? fallback : `$${Math.round(numeric).toLocaleString()}`;
}

export function displayText(value: unknown, fallback = "Not published") {
  return typeof value === "string" && value.trim() && value.trim() !== "—" ? value.trim() : fallback;
}

export function displayDate(value: unknown, fallback = "Not published") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(timestamp);
}

export function safeImageUrl(value: unknown): string | undefined {
  const result = inspectImageUrl(value);
  return result.accepted ? result.url ?? undefined : undefined;
}
