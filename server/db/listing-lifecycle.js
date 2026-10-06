'use strict';

/**
 * Has this listing's opportunity already passed?
 *
 * This decides what may be removed from inventory, so the rule is deliberately
 * narrow: a record is only CONCLUDED when the publisher itself said the event
 * finished. Anything unknown, contradictory or merely stale is KEPT, because
 * deleting a live opportunity to tidy a table is the expensive mistake and
 * keeping one dead record is cheap - the collector removes it on the next run.
 *
 * The contradictions are the interesting part:
 *
 *  - A publisher-reported date in the past is normally conclusive. But a record
 *    whose status says "postponed" is carrying the PRE-postponement date; the
 *    rescheduled date is not in the record. Deleting it would throw away a live
 *    auction, so postponement wins over the date and the record is kept.
 *
 *  - "Outbid Period" is still live. "Coming Soon" is still live. "Active" is
 *    still live - however old the observation that says so.
 *
 *  - An observation is never itself a reason to delete. Everything in the store
 *    was observed 16-31 days ago because the collector has not run; that is a
 *    freshness problem to be reported, not a per-row verdict.
 */

/** Publisher wording that means the sale event is over. */
const TERMINAL_STATUS = [
  { pattern: /\bauction is closed\b/i, verdict: 'publisher_status_closed', label: 'publisher status: auction closed' },
  { pattern: /\bclosed\b/i, verdict: 'publisher_status_closed', label: 'publisher status: closed' },
  { pattern: /\bcancell?ed\b/i, verdict: 'publisher_status_cancelled', label: 'publisher status: cancelled' },
  { pattern: /\brescinded\b/i, verdict: 'publisher_status_rescinded', label: 'publisher status: rescinded' },
  { pattern: /\bwithdrawn\b/i, verdict: 'publisher_status_withdrawn', label: 'publisher status: withdrawn' },
  // "Auctioned - Sold to 3rd Party", "Auctioned - Reverted to Beneficiary",
  // "Auctioned - Pending Results": the bidding window has closed in all three.
  { pattern: /\bauctioned\b/i, verdict: 'publisher_status_auctioned', label: 'publisher status: auctioned' },
  { pattern: /\bsold to\b/i, verdict: 'publisher_status_sold', label: 'publisher status: sold' },
];

/** Wording that says the event moved rather than ended. Wins over a past date. */
const POSTPONED_STATUS = /\bpostpon(ed)?\b|\bactive - postponed\b/i;

/**
 * Read the publisher's event dates out of the stored raw payload.
 *
 * Only `endDate` is returned as conclusive evidence. `startDate` in the past
 * merely means bidding has opened - an auction that opened in September and
 * ends in December is live, and treating its start date as a closing removed
 * exactly that class of record. A startDate with no endDate is therefore not
 * evidence of anything.
 */
function publisherEventTimes(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return [];
  }
  const run = parsed && parsed.auctionRun;
  if (!run) return [];
  const t = Date.parse(run.endDate || '');
  return Number.isFinite(t) ? [{ field: 'endDate', time: t }] : [];
}

/**
 * Classify one stored listing.
 *
 * @param {object} record  a row from `listings` (id, lifecycle_status, raw_notice, sale_date)
 * @param {number} [now]  epoch ms; injectable so the rule can be tested at a fixed instant
 * @returns {{concluded: boolean, verdict: string, label: string, conflicting: boolean, note: string|null}}
 */
function classifyListing(record = {}, now = Date.now()) {
  const lifecycle = String(record.lifecycleStatus ?? record.lifecycle_status ?? '');
  const canonical = String(record.status ?? '');

  const keep = (verdict, label, note = null, conflicting = false) =>
    ({ concluded: false, verdict, label, conflicting, note });

  for (const rule of TERMINAL_STATUS) {
    if (rule.pattern.test(lifecycle)) {
      return { concluded: true, verdict: rule.verdict, label: rule.label, conflicting: false, note: null };
    }
  }

  const times = publisherEventTimes(record.rawNotice ?? record.raw_notice);
  const past = times.filter(t => t.time < now).sort((a, b) => b.time - a.time)[0];

  if (POSTPONED_STATUS.test(lifecycle)) {
    return past
      ? keep('postponed_after_past_date', 'publisher status: postponed',
        `Record carries a past ${past.field} of ${new Date(past.time).toISOString()} but says postponed; the rescheduled date is not in this record, so the opportunity may still be open.`)
      : keep('postponed', 'publisher status: postponed');
  }

  if (past) {
    return {
      concluded: true,
      verdict: 'publisher_date_passed',
      label: `publisher ${past.field} passed: ${new Date(past.time).toISOString()}`,
      conflicting: false,
      note: null,
    };
  }

  // A canonical 'sold' or 'cancelled' with no publisher date behind it is still
  // a publisher verdict: it was derived from publisher text at write time.
  if (canonical === 'sold') {
    return { concluded: true, verdict: 'canonical_sold', label: 'status: sold', conflicting: false, note: null };
  }
  if (canonical === 'cancelled') {
    return { concluded: true, verdict: 'canonical_cancelled', label: 'status: cancelled', conflicting: false, note: null };
  }

  const sale = Date.parse(record.saleDate ?? record.sale_date ?? '');
  if (Number.isFinite(sale) && sale < now) {
    // A sale date in the past is weaker than a publisher event date: for parcel
    // and docket evidence the date is the record's subject, not a closing.
    return keep('sale_date_passed', `sale_date passed: ${new Date(sale).toISOString()}`,
      'sale_date is in the past but the publisher reported no closed/cancelled status; kept because this date alone does not prove the opportunity ended.');
  }

  return keep('no_conclusive_signal', 'no conclusive terminal signal');
}

module.exports = { classifyListing, publisherEventTimes, TERMINAL_STATUS, POSTPONED_STATUS };