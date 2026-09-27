export type InventoryHonesty = {
  shown: number;
  openingBidPublished: number;
  saleDateMissing: number;
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

/** Coverage from the records in hand. Never invents a catalog-wide count. */
export function summarizeInventoryHonesty(
  listings: ReadonlyArray<{ openingBid?: unknown; saleDate?: unknown }>,
): InventoryHonesty {
  let openingBidPublished = 0;
  let saleDateMissing = 0;
  for (const listing of listings) {
    if (publishedAmount(listing?.openingBid)) openingBidPublished += 1;
    if (!publishedDate(listing?.saleDate)) saleDateMissing += 1;
  }
  return {
    shown: listings.length,
    openingBidPublished,
    saleDateMissing,
  };
}
