'use strict';
// scripts/probe-retired-records.js
//
// Answers one question the inventory could not: for records that have aged out
// of their publisher's index, is the publisher still serving the record itself?
//
// Absence from an index is not evidence of absence. A county sale listing only
// shows upcoming auctions, so a record that sold, was withdrawn, or simply aged
// out disappears from the index while the publisher may still hold the detail
// page. Retiring on "no longer in the feed" would therefore destroy real
// inventory on the strength of an absence.
//
// So this asks the publisher directly, per record, and reports what it finds.
//
// THE TRAP THIS SCRIPT EXISTS TO AVOID
// CivilView answers HTTP 200 for property ids it no longer publishes: the
// response is a branded, client-rendered shell with none of the record's data.
// A probe that treats "HTTP 200" as "still live" would mark every dead record
// fresh and manufacture exactly the false evidence this project refuses to
// publish. Verified on the live publisher: an id still on the county index
// parses to a full record, an id that has aged out parses to null.
//
// This script is READ-ONLY. It reports; it never deletes or retires anything.
// Deciding what to do about a confirmed-missing record is the owner's call.

const { CivilViewScraper } = require('../server/scrapers/civilview');

const DEFAULT_LIMIT = 25;

/**
 * Decide what a fetched detail page means.
 *
 * A response only counts as "served" when the publisher's own parser recovered
 * a real record. Anything else - an empty shell, a null parse, or a throw - is
 * "not served" or "error", and those are reported separately so a network fault
 * is never mistaken for a dead record.
 *
 * @returns {'served'|'not_served'|'error'}
 */
function classifyDetailResponse(result) {
  if (result && result.error) return 'error';
  if (result && result.parsed && result.parsed.address) return 'served';
  return 'not_served';
}

function parseCivilViewId(id) {
  const match = /^CIV-([A-Z]{2})-(\d+)-(\d+)$/.exec(String(id || ''));
  if (!match) return null;
  return { state: match[1], countyId: match[2], propertyId: match[3] };
}

async function fetchInventory(baseUrl, source, limit) {
  const response = await fetch(`${baseUrl}/api/listings?source=${encodeURIComponent(source)}&limit=${limit}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`inventory request returned HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.listings) ? payload.listings : [];
}

/**
 * @returns {{source:string, sampled:number, served:number, notServed:number,
 *            errored:number, records:Array}}
 */
async function probeRetiredRecords(options = {}) {
  const source = options.source || 'civilview';
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const baseUrl = options.baseUrl || process.env.PROPERTY_API_URL || 'http://localhost:3000';
  const scraper = options.scraper || new CivilViewScraper({ maxRetries: 0, maxDetailPages: 0 });
  // Injected in tests so the suite never reaches the publisher.
  const loadInventory = options.fetchInventory || fetchInventory;

  const inventory = await loadInventory(baseUrl, source, limit);
  const cookieByCounty = new Map();

  async function cookieFor(countyId) {
    if (cookieByCounty.has(countyId)) return cookieByCounty.get(countyId);
    // The detail pages are client-rendered behind a session cookie established
    // by visiting the county index. Without it every id looks like a dead one.
    const counties = await scraper.fetchCounties();
    const county = counties.find((candidate) => String(candidate.id) === String(countyId));
    if (!county) return null;
    const { sessionCookie } = await scraper.fetchCountySummaries(county);
    cookieByCounty.set(countyId, sessionCookie);
    return sessionCookie;
  }

  const records = [];
  for (const record of inventory) {
    const identity = parseCivilViewId(record.id);
    if (!identity) {
      records.push({ id: record.id, verdict: 'error', detail: 'identifier does not encode a publisher record key' });
      continue;
    }
    try {
      const cookie = await cookieFor(identity.countyId);
      if (!cookie) {
        records.push({ id: record.id, verdict: 'error', detail: `county ${identity.countyId} unavailable` });
        continue;
      }
      const url = `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${identity.propertyId}`;
      const html = await scraper.fetchText(url, options.timeoutMs || 20000, cookie);
      let parsed = null;
      try {
        parsed = scraper.parseDetailPage(html, {
          propertyId: identity.propertyId,
          county: { id: identity.countyId, state: identity.state },
          detailUrl: url,
        });
      } catch (err) {
        records.push({ id: record.id, verdict: 'error', detail: err.message });
        continue;
      }
      records.push({ id: record.id, verdict: classifyDetailResponse({ parsed }), detail: url });
    } catch (err) {
      records.push({ id: record.id, verdict: 'error', detail: err.message });
    }
  }

  return {
    source,
    sampled: records.length,
    served: records.filter((r) => r.verdict === 'served').length,
    notServed: records.filter((r) => r.verdict === 'not_served').length,
    errored: records.filter((r) => r.verdict === 'error').length,
    records,
  };
}

module.exports = { probeRetiredRecords, classifyDetailResponse, parseCivilViewId, fetchInventory };

if (require.main === module) {
  const args = process.argv.slice(2);
  const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  probeRetiredRecords({
    source: argValue('--source', 'civilview'),
    limit: Number(argValue('--limit', DEFAULT_LIMIT)) || DEFAULT_LIMIT,
  })
    .then((summary) => {
      for (const record of summary.records) {
        process.stdout.write(`${record.verdict.toUpperCase().padEnd(10)} ${record.id}${record.detail ? ` - ${record.detail}` : ''}\n`);
      }
      process.stdout.write(
        `\n${summary.source}: sampled ${summary.sampled}, publisher still serves ${summary.served}, ` +
        `not served ${summary.notServed}, errors ${summary.errored}\n` +
        'READ-ONLY: nothing was retired. Confirmed-missing records are evidence for an owner decision, not one.\n',
      );
      process.exitCode = summary.errored > 0 ? 2 : 0;
    })
    .catch((err) => {
      console.error(`probe failed: ${err.message}`);
      process.exitCode = 1;
    });
}