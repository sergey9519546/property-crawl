// Evidence ink: pure rules behind <Fact> and <GapLedger>. No React, no
// imports, so node can test it directly (test/evidence.test.mjs).

export type FactOrigin = "printed" | "yours" | "unverified";
export type FactFormat = "money" | "date" | "text";

/**
 * Why a value is missing. Default to "Not in the notice"; only use another
 * reason when the source's own rules prove it, or the reason is invented data.
 */
export type UnknownReason = "Not in the notice" | "Set at the sale" | "Not checked yet";

export function factText(value: unknown, format: FactFormat = "text"): string | null {
  if (format === "money") {
    const n = value === null || value === "" ? NaN : Number(value);
    return !Number.isFinite(n) || n <= 0 ? null : `$${Math.round(n).toLocaleString("en-US")}`;
  }
  if (format === "date") {
    if (typeof value !== "string" || !value.trim()) return null;
    const t = Date.parse(value);
    const isoDay = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
    return Number.isFinite(t) && (!isoDay || new Date(t).toISOString().slice(0, 10) === isoDay)
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(t)
      : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t && !/^(?:—|-|unknown|n\/a|null|undefined|not published|tbd|tba|not specified|unspecified)$/i.test(t) ? t : null;
}

export type GapListing = {
  id: string;
  state?: string | null;
  county?: string | null;
  gisUrl?: string | null;
  occupancy?: string | null;
  seniorLienRisk?: string | null;
  deposit?: string | null;
  redemptionDays?: unknown;
  redemptionWarning?: string | null;
  openingBid?: unknown;
  saleDate?: string | null;
  sourceUrl?: string | null;
};

export type Gap = {
  key: string;
  fact: string;
  reason: UnknownReason;
  why: string;
  action: { label: string; href: string; external?: boolean };
};

// Fixed priority: what can cost a buyer most comes first. The order is a
// house rule, not a cost estimate.
export function findGaps(listing: GapListing): Gap[] {
  const cleanState = typeof listing.state === "string" && /^[A-Za-z]{2}$/.test(listing.state.trim())
    ? listing.state.trim().toUpperCase()
    : null;
  const countySlug = typeof listing.county === "string" && listing.county.trim()
    ? listing.county.trim().toLowerCase().replace(/\s+(?:county|parish|borough)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : null;
  const stateHref = cleanState ? `/states/${encodeURIComponent(cleanState)}` : "/resources#knowledge-base";
  const countyOrGisHref = listing.gisUrl || (cleanState && countySlug ? `/states/${encodeURIComponent(cleanState)}/${encodeURIComponent(countySlug)}` : stateHref);
  const notice = listing.sourceUrl
    ? { label: "Read the original notice", href: listing.sourceUrl, external: true }
    : { label: "Search county records", href: countyOrGisHref, ...(listing.gisUrl ? { external: true } : {}) };
  const gaps: Gap[] = [];
  if (factText(listing.occupancy) === null) {
    gaps.push({ key: "occupancy", fact: "Whether anyone lives there", reason: "Not in the notice", why: "You may not get inside before the sale, and moving people out can cost time and money.", action: { label: "Drive by and look, then check the notice", href: notice.href, external: notice.external } });
  }
  // A risk pattern never establishes the scope or result of a title search.
  {
    gaps.push({ key: "liens", fact: "Debts that stay with the property", reason: "Not checked yet", why: "Some liens survive the sale, and the new owner pays them.", action: { label: "Order a title search or inspect county GIS", href: countyOrGisHref, ...(listing.gisUrl ? { external: true } : {}) } });
  }
  if (factText(listing.deposit) === null) {
    gaps.push({ key: "deposit", fact: "The deposit on sale day", reason: "Not in the notice", why: "Many sales want certified funds on the day. Without them you can't bid.", action: notice });
  }
  const redemption = typeof listing.redemptionDays === "number" ? listing.redemptionDays : null;
  if (redemption === null && factText(listing.redemptionWarning) === null) {
    gaps.push({ key: "redemption", fact: "How long the owner can buy it back", reason: "Not in the notice", why: "In some states the former owner can reclaim the property after you win.", action: { label: cleanState ? `Check ${cleanState} redemption rules` : "Check your state's rule", href: stateHref } });
  }
  if (factText(listing.openingBid, "money") === null) {
    gaps.push({ key: "openingBid", fact: "The opening bid", reason: "Not in the notice", why: "You won't know the starting price until the sale, so plan your top bid from your own numbers.", action: notice });
  }
  if (factText(listing.saleDate, "date") === null) {
    gaps.push({ key: "saleDate", fact: "The sale date", reason: "Not in the notice", why: "Sales get moved. Without a date you can't plan funds or inspection.", action: notice });
  }
  return gaps;
}

export function listingFactOrigin(listing: { provenance?: { origin?: string; observed?: boolean; derivedFields?: Record<string, unknown> } | null }, field: string): FactOrigin {
  const p = listing.provenance;
  return p?.observed === true && (p.origin === "live" || p.origin === "email_notice") && !p.derivedFields?.[field] ? "printed" : "unverified";
}

export type ChecklistStatus = "verified" | "flagged" | "pending";
export function restoreChecklistStatuses(raw: string | null, defaults: Record<string, ChecklistStatus>): Record<string, ChecklistStatus> {
  const restored = { ...defaults };
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return restored;
    for (const id of Object.keys(defaults)) {
      const status = (parsed as Record<string, unknown>)[id];
      if (status === "verified" || status === "flagged" || status === "pending") restored[id] = status;
    }
  } catch { /* Retain defaults when storage is unreadable. */ }
  return restored;
}

