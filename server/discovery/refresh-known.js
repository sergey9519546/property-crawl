'use strict';
// server/discovery/refresh-known.js
//
// Re-observe records we already hold, by asking the publisher for the record
// itself rather than for an index of what is for sale right now.
//
// Why this exists
// A collector that only ever reads an index can only ever refresh what that
// index currently lists. An auction that sold, was withdrawn, or simply fell
// outside this run's budget disappears from the index while the publisher still
// holds the detail page - and the record then ages into "stale" despite being
// entirely live. Measured on the current inventory: of 16 stale records across
// treasury, gsa and irs, every one was still served by its publisher.
//
// The distinction that matters: absence from an index is NOT evidence of
// absence. Refreshing by known identifier is how that is settled.
//
// The trap this must never fall into
// Some publishers answer HTTP 200 for records they no longer publish - CivilView
// serves a branded, client-rendered shell with none of the record's data. A
// refresh that trusted the status code would mark dead records fresh and
// manufacture the exact false evidence this project refuses to publish. So a
// record counts as refreshed only when the publisher's own parser recovered it.

/**
 * The publisher's own record key, read from the URL we stored for the record.
 *
 * Deliberately read from `sourceUrl` rather than reconstructed from the local
 * id: the local id is this app's naming, and assuming it round-trips is exactly
 * the kind of guess that makes a refresh confidently wrong.
 */
function extractPublisherKey(source, sourceUrl, id) {
  const url = String(sourceUrl || '');
  switch (source) {
    case 'civilview': {
      const match = /[?&]PropertyId=(\d+)/i.exec(url);
      return match ? match[1] : null;
    }
    case 'gsa': {
      const match = /[?&]property_id=(\d+)/i.exec(url);
      return match ? match[1] : null;
    }
    case 'irs': {
      const match = /\/ad\/([a-z0-9-]+)/i.exec(url);
      return match ? match[1] : null;
    }
    case 'treasury': {
      const match = /\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url);
      return match ? match[1] : null;
    }
    default:
      return id ? String(id) : null;
  }
}

/** Has the publisher not re-observed this record recently? */
function isStale(record) {
  const freshness = record && record.sourceFreshness;
  return !freshness || freshness.status !== 'current';
}

/**
 * Decide what one refreshed fetch means.
 * @returns {'refreshed'|'not_served'|'error'}
 */
function classifyRefresh(result) {
  if (result && result.error) return 'error';
  if (result && result.listing && result.listing.address) return 'refreshed';
  return 'not_served';
}

/**
 * Re-observe one record.
 *
 * @returns {Promise<{id:string, verdict:string, listing?:object, detail?:string}>}
 */
async function refreshKnownRecord(scraper, source, record) {
  const id = record && record.id;
  try {
    if (!scraper || typeof scraper.fetchDetail !== 'function') {
      return { id, verdict: 'error', detail: `${source} has no per-record detail method` };
    }
    const key = extractPublisherKey(source, record.sourceUrl, id);
    if (!key) {
      // A record we cannot address is an error, never "the publisher does not
      // serve it" - conflating the two would manufacture a death certificate.
      return { id, verdict: 'error', detail: 'stored source URL carries no publisher record key' };
    }
    const detail = await scraper.fetchDetail(key);
    if (!detail || !detail.address) {
      return { id, verdict: 'not_served', detail: record.sourceUrl || null };
    }
    // Reuse the collector's own normalizer so a refreshed record is
    // indistinguishable from one found by an index sweep.
    const listing = typeof scraper.standardizeListing === 'function'
      ? scraper.standardizeListing(detail)
      : detail;
    return { id, verdict: classifyRefresh({ listing }), listing };
  } catch (err) {
    return { id, verdict: 'error', detail: err.message };
  }
}

/**
 * Refresh a batch. Never retires anything: a record the publisher no longer
 * serves is reported, and the decision about what that means is the owner's.
 */
async function refreshKnownRecords({ source, scraper, records }) {
  const results = [];
  for (const record of records || []) {
    results.push(await refreshKnownRecord(scraper, source, record));
  }
  return {
    source,
    attempted: results.length,
    refreshed: results.filter((r) => r.verdict === 'refreshed'),
    notServed: results.filter((r) => r.verdict === 'not_served'),
    errored: results.filter((r) => r.verdict === 'error'),
  };
}

module.exports = {
  extractPublisherKey, isStale, classifyRefresh, refreshKnownRecord, refreshKnownRecords,
};