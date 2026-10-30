export type ListingStatusTone = "open" | "held" | "sold" | "finished" | "neutral";

const TONE_CLASS: Record<ListingStatusTone, string> = {
  open: "bg-go-wash text-go",
  held: "bg-catch-wash text-catch-ink",
  sold: "bg-line text-ink-2",
  finished: "bg-line text-ink-3",
  neutral: "bg-paper text-ink-3",
};

/**
 * Color and structured-data availability for a published status phrase.
 * Sold is a recorded sale. Closed, auctioned, cancelled, and withdrawn are
 * finished auctions, not sales and not open inventory. Unrecognized words,
 * including "foreclosed" and "unsold", stay neutral.
 */
export function listingStatusTone(label: string): ListingStatusTone {
  const text = label.toLowerCase();
  if (/\bsold\b/.test(text)) return "sold";
  if (/\bcancell?ed\b|\bwithdrawn\b/.test(text)) return "finished";
  if (/\bclosed\b|\bauctioned\b|\bpost[-\s]?auction\b/.test(text)) return "finished";
  if (/\bpostponed\b|\badjourned\b|\bstayed\b/.test(text)) return "held";
  if (/\bactive\b|\bscheduled\b|\bpending\b|\bcoming soon\b|\bpre[-\s]?auction\b|\bpublicly listed\b/.test(text)) return "open";
  return "neutral";
}

/** A terminal or held phrase wins over a word that only says the auction is open. */
export function combineStatusTones(tones: ListingStatusTone[]): ListingStatusTone {
  if (tones.includes("sold")) return "sold";
  if (tones.includes("finished")) return "finished";
  if (tones.includes("held")) return "held";
  if (tones.includes("open")) return "open";
  return "neutral";
}

export function listingStatusClass(tone: ListingStatusTone): string {
  return TONE_CLASS[tone];
}

/**
 * InStock only when the phrase says the auction is open.
 * SoldOut only for a recorded sale. Finished, held, and unknown phrases
 * omit availability so a closed auction is not labeled sold or in stock.
 */
export function listingOfferAvailability(tone: ListingStatusTone): string | undefined {
  if (tone === "sold") return "https://schema.org/SoldOut";
  if (tone === "open") return "https://schema.org/InStock";
  return undefined;
}
