// Evidence ink: pure rules behind <Fact> and <GapLedger>. No React, no
// imports, so node can test it directly (test/evidence.test.mjs).

export type FactOrigin = "printed" | "yours";
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
    return Number.isFinite(t)
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(t)
      : factText(value); // unparseable: same sentinel rules as text ("TBD" is not a date)
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t && !/^(?:—|-|unknown|n\/a|null|undefined|not published|tbd|tba|not specified|unspecified)$/i.test(t) ? t : null;
}

export type GapListing = {
  id: string;
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
  const notice = listing.sourceUrl
    ? { label: "Read the original notice", href: listing.sourceUrl, external: true }
    : { label: "Search the county's sale records", href: "/resources#knowledge-base" };
  const gaps: Gap[] = [];
  if (factText(listing.occupancy) === null) {
    gaps.push({ key: "occupancy", fact: "Whether anyone lives there", reason: "Not in the notice", why: "You may not get inside before the sale, and moving people out can cost time and money.", action: { label: "Drive by and look, then check the notice", href: notice.href, external: notice.external } });
  }
  const lien = factText(listing.seniorLienRisk);
  if (lien === null || /^unknown$/i.test(lien)) {
    gaps.push({ key: "liens", fact: "Debts that stay with the property", reason: "Not checked yet", why: "Some liens survive the sale, and the new owner pays them.", action: { label: "Order a title search before you bid", href: "/resources#knowledge-base" } });
  }
  if (factText(listing.deposit) === null) {
    gaps.push({ key: "deposit", fact: "The deposit on sale day", reason: "Not in the notice", why: "Many sales want certified funds on the day. Without them you can't bid.", action: notice });
  }
  const redemption = typeof listing.redemptionDays === "number" ? listing.redemptionDays : null;
  if (redemption === null && factText(listing.redemptionWarning) === null) {
    gaps.push({ key: "redemption", fact: "How long the owner can buy it back", reason: "Not in the notice", why: "In some states the former owner can reclaim the property after you win.", action: { label: "Check your state's rule", href: "/resources#knowledge-base" } });
  }
  if (factText(listing.openingBid, "money") === null) {
    gaps.push({ key: "openingBid", fact: "The opening bid", reason: "Not in the notice", why: "You won't know the starting price until the sale, so plan your top bid from your own numbers.", action: notice });
  }
  if (factText(listing.saleDate, "date") === null) {
    gaps.push({ key: "saleDate", fact: "The sale date", reason: "Not in the notice", why: "Sales get moved. Without a date you can't plan funds or inspection.", action: notice });
  }
  return gaps;
}

