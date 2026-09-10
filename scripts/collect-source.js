#!/usr/bin/env node
// Deliberately bounded local collection. Does not rewrite data.js or snapshots.
const path = require('node:path');
const { mergeLiveRecords, loadLiveRecords } = require('../server/db/live-record-store');

function supportedScraperMap() {
  const scheduler = require('../server/scrapers/scheduler');
  return new Map((scheduler.realScrapers || [])
    .filter((scraper) => scraper && typeof scraper.scrapeFeed === 'function')
    .filter((scraper) => scraper.fixtureOnly !== true && scraper.historicalOnly !== true)
    .filter((scraper) => typeof scraper.sourceKey === 'string' && scraper.sourceKey)
    .map((scraper) => [scraper.sourceKey, scraper]));
}

function supportedSources() {
  return [...supportedScraperMap().keys()].sort();
}

function parseOptions(args) {
  const options = { targetState: 'NJ', maxCounties: 1, maxDetailPages: 12, newFirst: false };
  const numeric = { '--counties': ['maxCounties', 10], '--limit': ['maxDetailPages', 120] };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--new-first') { options.newFirst = true; continue; }
    if (flag === '--state') {
      const value = args[++index];
      if (!/^[A-Z]{2}$/.test(value || '')) throw new Error('--state requires a two-letter uppercase state code');
      options.targetState = value;
    } else if (numeric[flag]) {
      const [field, maximum] = numeric[flag];
      const value = args[++index];
      if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > maximum) throw new Error(`${flag} must be an integer between 1 and ${maximum}`);
      options[field] = Number(value);
    } else throw new Error(`Unknown collection option: ${flag}`);
  }
  return options;
}

async function collect(source, options = {}) {
  if (source !== 'civilview' && Object.keys(options).some((key) => key !== 'storePath' && key !== 'observationPath')) throw new Error('Coverage options are supported only for civilview');
  const storePath = options.storePath || process.env.PROPERTY_LIVE_CACHE_PATH || path.resolve(__dirname, '../.cache/live-listings.json');
  const previous = loadLiveRecords(storePath);
  const scraperMap = supportedScraperMap();
  if (!scraperMap.has(source)) throw new Error(`Choose a scheduler-backed collector: ${supportedSources().join(', ')}`);
  let scraper = scraperMap.get(source);
  if (source === 'civilview') {
    const { CivilViewScraper } = require('../server/scrapers/civilview');
    scraper = new CivilViewScraper({
      maxCounties: options.maxCounties || 1, maxDetailPages: options.maxDetailPages || 12,
      targetState: options.targetState || 'NJ', maxRetries: 1,
      observedRecordIds: options.newFirst ? previous.map((record) => record.id) : [],
    });
  }
  const startedAt = Date.now();
  let records;
  try {
    records = await scraper.scrapeFeed();
    if (!Array.isArray(records)) throw new TypeError(`${source} returned a non-array payload`);
    const { recordSourceRun } = require('../server/sources/observations');
    recordSourceRun(source, {
      listings: records,
      error: null,
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    }, { filePath: options.observationPath });
  } catch (error) {
    try {
      const { recordSourceRun } = require('../server/sources/observations');
      recordSourceRun(source, {
        listings: [],
        error: error.message,
        rejectedCount: 0,
        durationMs: Date.now() - startedAt,
      }, { filePath: options.observationPath });
    } catch (observationError) {
      error.observationError = observationError;
    }
    throw error;
  }
  // A collect-source run is treated as a partial observation unless
  // --reconcile is passed: the absence of a record in this call is not
  // evidence the record was withdrawn. Operators explicitly opt into
  // reconciliation when they have confirmed a complete source sweep.
  const reconcile = process.argv.includes('--reconcile');
  const result = mergeLiveRecords(storePath, records, { sourceKey: source, runCompleted: reconcile });
  const previousIds = new Set(previous.map((record) => record.id));
  console.log(JSON.stringify({ source, ...result, newRecordCandidates: records.filter((record) => !previousIds.has(record.id)).length, recordsWithPhotos: records.filter((record) => record.photo).length, recordsWithZip: records.filter((record) => record.zip).length, coverage: scraper.lastRunReport || null }));
  return result;
}

if (require.main === module) Promise.resolve().then(() => {
  if (process.argv[2] === '--list') {
    console.log(JSON.stringify({ sources: supportedSources() }));
    return null;
  }
  return collect(process.argv[2], process.argv.length > 3 ? parseOptions(process.argv.slice(3)) : {});
}).catch((error) => { console.error('[collect-source]', error.message); process.exitCode = 1; });
module.exports = { collect, parseOptions, supportedSources };
