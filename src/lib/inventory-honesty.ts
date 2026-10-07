export type InventoryHonesty = {
  shown: number;
  openingBidPublished: number;
  saleDateMissing: number;
  dealScorePresent: number;
};

function publishedAmount(value: unknown): boolean {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function publishedDate(value: unknown): boolean {
  if (value == null) return false;
  const text = String(value).trim();
  return text.length > 0 && text.toLowerCase() !== "unknown";
}

/**
 * Whether this record carries a deal score at all.
 *
 * Deal score is derived, not published: the API withholds it unless a record
 * has both an opening amount and an estimated range, so "absent" means "not
 * computable from what the publisher gave us", never "zero".
 */
function hasDealScore(value: unknown): boolean {
  if (value == null) return false;
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score);
}

/** Coverage from the records in hand. Never invents a catalog-wide count. */
export function summarizeInventoryHonesty(
  listings: ReadonlyArray<{ openingBid?: unknown; saleDate?: unknown; dealScore?: unknown }>,
): InventoryHonesty {
  let openingBidPublished = 0;
  let saleDateMissing = 0;
  let dealScorePresent = 0;
  for (const listing of listings) {
    if (publishedAmount(listing?.openingBid)) openingBidPublished += 1;
    if (!publishedDate(listing?.saleDate)) saleDateMissing += 1;
    if (hasDealScore(listing?.dealScore)) dealScorePresent += 1;
  }
  return {
    shown: listings.length,
    openingBidPublished,
    saleDateMissing,
    dealScorePresent,
  };
}
