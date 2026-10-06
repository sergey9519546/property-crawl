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

const DEFAULT_LIMIT = 25;

/**
 * Decide what a fetched detail page means.
 *
 * A response only counts as "served" when the publisher's own code recovered a
 * real record. Anything else - an empty shell, a null parse, or a throw - is
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

/**
 * The publisher's own record key, read from the URL we stored for the record.
 *
 * Deliberately read from `sourceUrl` rather than reconstructed from the local
 * id: the local id is this app's naming, and assuming it round-trips is exactly
 * the kind of guess that makes a probe confidently wrong.
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

/** Which scraper module and constructor serve each probeable source. */
const SOURCE_SCRAPERS = {
  civilview: { module: '../server/scrapers/civilview', ctor: 'CivilViewScraper' },
  treasury: { module: '../server/scrapers/treasury', ctor: 'TreasuryForfeitureScraper' },
  gsa: { module: '../server/scrapers/gsa', ctor: 'GsaSurplusScraper' },
  irs: { module: '../server/scrapers/irs', ctor: 'IrsSeizedScraper' },
};

function scraperForSource(source, options = {}) {
  if (options.scraper) return options.scraper;
  const binding = SOURCE_SCRAPERS[source];
  if (!binding) return null;
  const loaded = require(binding.module);
  const Ctor = loaded[binding.ctor];
  return Ctor ? new Ctor(options.constructorOptions || { maxRetries: 0, maxDetailPages: 0 }) : null;
}

function isStale(record) {
  const freshness = record && record.sourceFreshness;
  // A record with no freshness block has never been re-observed, which is the
  // definition of stale here.
  return !freshness || freshness.status !== 'current';
}

async function fetchInventory(baseUrl, source, limit) {
  const response = await fetch(`${baseUrl}/api/listings?source=${encodeURIComponent(source)}&limit=${limit}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`inventory request returned HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.listings) ? payload.listings : [];
}

/** CivilView needs a county session cookie before any detail page is readable. */
async function civilviewProbe(scraper, record) {
  const identity = /^CIV-([A-Z]{2})-(\d+)-(\d+)$/.exec(String(record.id || ''));
  const propertyId = extractPublisherKey('civilview', record.sourceUrl);
  // A record we cannot address is an error, never "the publisher does not
  // serve it" - conflating the two would manufacture a death certificate.
  if (!identity) return { error: 'identifier does not encode a county and property id' };
  if (!propertyId) return { error: 'stored source URL carries no PropertyId' };
  const counties = await scraper.fetchCounties();
  const county = counties.find((candidate) => String(candidate.id) === String(identity[2]));
  if (!county) return { error: `county ${identity[2]} is not published` };
  const { sessionCookie } = await scraper.fetchCountySummaries(county);
  const url = `https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=${propertyId}`;
  const html = await scraper.fetchText(url, 20000, sessionCookie);
  return { parsed: scraper.parseDetailPage(html, {
    propertyId, county: { id: identity[2], state: identity[1] }, detailUrl: url,
  }) };
}

/**
 * @returns {{source:string, sampled:number, served:number, notServed:number,
 *            errored:number, unsupported:boolean, records:Array}}
 */
async function probeRetiredRecords(options = {}) {
  const source = options.source || 'civilview';
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const baseUrl = options.baseUrl || process.env.PROPERTY_API_URL || 'http://localhost:3000';
  const loadInventory = options.fetchInventory || fetchInventory;

  if (!options.scraper && !SOURCE_SCRAPERS[source]) {
    return {
      source, sampled: 0, served: 0, notServed: 0, errored: 0, unsupported: true, records: [],
    };
  }
  const scraper = scraperForSource(source, options);
  // Probe the records the question is actually about. Sampling the first N of a
  // source mixes in records that are already fresh, where "still served" is
  // true by definition and therefore proves nothing.
  const staleOnly = options.staleOnly !== false;
  const everything = await loadInventory(baseUrl, source, staleOnly ? 500 : limit);
  const inventory = (staleOnly ? everything.filter(isStale) : everything).slice(0, limit);

  const records = [];
  for (const record of inventory) {
    try {
      let probed;
      if (source === 'civilview') {
        probed = await civilviewProbe(scraper, record);
      } else {
        const key = extractPublisherKey(source, record.sourceUrl, record.id);
        if (!key) {
          records.push({ id: record.id, verdict: 'error', detail: 'stored source URL carries no publisher record key' });
          continue;
        }
        // Each scraper returns null when the publisher no longer holds the
        // record, so its own answer is the verdict - not the HTTP status.
        const detail = await scraper.fetchDetail(key);
        probed = { parsed: detail && detail.address ? detail : null };
      }
      records.push({ id: record.id, verdict: classifyDetailResponse(probed), detail: record.sourceUrl || null });
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
    unsupported: false,
    records,
  };
}

module.exports = {
  probeRetiredRecords, classifyDetailResponse, extractPublisherKey,
  fetchInventory, isStale, SOURCE_SCRAPERS,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const requested = (argValue('--source', 'civilview') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Number(argValue('--limit', DEFAULT_LIMIT)) || DEFAULT_LIMIT;

  Promise.all(requested.map((source) => probeRetiredRecords({ source, limit })))
    .then(async (summaries) => {
      for (const summary of summaries) {
        if (summary.unsupported) {
          process.stdout.write(`\n${summary.source}: no per-record probe is implemented for this source\n`);
          continue;
        }
        for (const record of summary.records) {
          process.stdout.write(`${record.verdict.toUpperCase().padEnd(10)} ${record.id}\n`);
        }
        process.stdout.write(
          `\n${summary.source}: sampled ${summary.sampled}, publisher still serves ${summary.served}, ` +
          `not served ${summary.notServed}, errors ${summary.errored}\n`,
        );
      }
      process.stdout.write('\nREAD-ONLY: nothing was retired. Confirmed-missing records are evidence for an owner decision, not one.\n');
      process.exitCode = summaries.some((s) => s.errored > 0) ? 2 : 0;
    })
    .catch((err) => {
      console.error(`probe failed: ${err.message}`);
      process.exitCode = 1;
    });
}