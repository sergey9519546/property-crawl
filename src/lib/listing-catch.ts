// "Here's the catch": a plain-English risk paragraph built only from fields the
// record actually carries. Every sentence names its source field; nothing is
// imputed. ponytail: deterministic rules, swap in a cached LLM paragraph later.

type CatchInput = {
  state?: string | null;
  openingBid?: unknown;
  estLow?: unknown;
  estHigh?: unknown;
  dealScore?: unknown;
  occupancy?: string | null;
  deposit?: string | null;
  saleDate?: string | null;
  redemptionDays?: unknown;
  redemptionWarning?: string | null;
  seniorLienRisk?: string | null;
  sourceFreshness?: { ageHours: number | null; status: string } | null;
};

export type ListingCatch = { flags: string[]; notes: string[] };

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !/^(?:—|unknown|n\/a)$/i.test(value.trim()) ? value.trim() : null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function listingCatch(listing: CatchInput, titleWarnings: string[] = []): ListingCatch {
  const flags: string[] = [];
  const notes: string[] = [];
  const bid = num(listing.openingBid);
  const low = num(listing.estLow);
  const high = num(listing.estHigh);

  if (bid !== null && bid > 0 && low !== null && high !== null && high >= low && low > 0) {
    const mid = (low + high) / 2;
    notes.push(`Opens at ${money(bid)}, ${Math.round((bid / mid) * 100)}% of the stored ${money(low)}–${money(high)} value range.`);
  } else if (bid !== null && bid > 0) {
    flags.push(`Opens at ${money(bid)}, but no value range was published, so there is no way to tell from this record whether that is a discount.`);
  } else {
    flags.push("No opening amount was published, so the price is unknown until the sale.");
  }

  const occupancy = text(listing.occupancy);
  if (!occupancy) flags.push("Occupancy is not published: assume no interior inspection and budget for a possible eviction.");
  else if (/occupied/i.test(occupancy) && !/unoccupied/i.test(occupancy)) flags.push(`Reported ${occupancy.toLowerCase()}: expect no interior access and possible eviction cost.`);
  else notes.push(`Reported ${occupancy.toLowerCase()}.`);

  const redemption = num(listing.redemptionDays);
  if (redemption !== null && redemption > 0) {
    flags.push(`${listing.state || "State"} redemption rule: up to ${Math.round(redemption)} days. The former owner may be able to buy it back after you win, so confirm the period in the sale terms.`);
  } else if (text(listing.redemptionWarning)) {
    flags.push(text(listing.redemptionWarning)!);
  }

  const lien = text(listing.seniorLienRisk);
  if (lien && !/^(low|none)$/i.test(lien)) flags.push(`Senior-lien signal is ${lien.toLowerCase()}: liens ahead of this sale may survive it.`);
  for (const warning of titleWarnings.slice(0, 2)) flags.push(warning);

  const deposit = text(listing.deposit);
  if (deposit) notes.push(`Deposit: ${deposit}.`);
  else flags.push("Deposit terms are not published. Many sales require certified funds on the day of the sale.");

  if (!text(listing.saleDate)) flags.push("No sale date is published.");

  const fresh = listing.sourceFreshness;
  if (fresh && fresh.status === "stale" && fresh.ageHours !== null) {
    flags.push(`The source was last checked ${Math.round(fresh.ageHours / 24)} days ago. Confirm it is still for sale.`);
  }

  return { flags, notes };
}
