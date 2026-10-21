// Priority bands for the opportunity-signal triage score (1-99).
//
// Bands are set from the measured live distribution, not from percentiles:
// on 2026-10-21 the actionable inventory (2,075 listings with future sale
// dates) scored 20 for 2,017 listings (a confirmed future sale date — the
// only signal that resolves broadly today) and 30 for 58 listings (sale
// date plus one observed event fact, e.g. a postponement-then-relist
// transition detected in observation history). Each band therefore names
// HOW MANY independent opportunity facts are confirmed:
//
//   30+ (Moderate): two facts — a confirmed auction plus one observed event
//                   (relist, bid reduction, or area corroboration).
//   50+ (High):     three facts (auction + relist + reduction = 50), or a
//                   deep verified discount through the ratio component.
//
// A band is never stretched to fit starved data: when valuation bands reach
// the inventory at scale, the ratio component pushes scores toward the top
// of the same scale. Re-measure before changing these numbers.

export const PRIORITY_HIGH_AT = 50;
export const PRIORITY_MODERATE_AT = 30;

export type PriorityBand = 'unscored' | 'routine' | 'moderate' | 'high';

export function priorityBand(priority: number): PriorityBand {
  if (!Number.isFinite(priority) || priority <= 0) return 'unscored';
  if (priority >= PRIORITY_HIGH_AT) return 'high';
  if (priority >= PRIORITY_MODERATE_AT) return 'moderate';
  return 'routine';
}
