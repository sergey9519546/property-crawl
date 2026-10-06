'use strict';
// scripts/refresh-known-records.js
//
// Re-observe records we already hold, by identifier, and write the refreshed
// observations back into the live record store.
//
// Why
// A collector that only reads an index can only refresh what the index currently
// lists. Everything else ages into "stale" even when the publisher still holds
// the record. Measured on the current inventory: 16 stale records across
// treasury, gsa and irs were ALL still served by their publishers - they were
// never dead, only unseen by an index sweep.
//
// This closes that gap. It never retires anything: a record the publisher no
// longer serves is reported and left exactly as it was. Deciding what a
// confirmed-missing record means is the owner's call, not a script's.
//
// Usage
//   node scripts/refresh-known-records.js --source treasury            # report only
//   node scripts/refresh-known-records.js --source treasury --apply    # write

const { mergeLiveRecords, resolveLiveStorePath } = require('../server/db/live-record-store');
const { refreshKnownRecords, isStale } = require('../server/discovery/refresh-known');
const { SOURCE_SCRAPERS } = require('./probe-retired-records');

async function readStaleRecords(baseUrl, source) {
  const response = await fetch(`${baseUrl}/api/listings?source=${encodeURIComponent(source)}&limit=500`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`inventory request returned HTTP ${response.status}`);
  const payload = await response.json();
  const records = Array.isArray(payload.listings) ? payload.listings : [];
  // Only stale records are the subject. A record already current would refresh
  // to the same answer and tell us nothing.
  return records.filter(isStale).map((record) => ({
    id: record.id,
    sourceUrl: record.sourceUrl,
  }));
}

function scraperFor(source) {
  const binding = SOURCE_SCRAPERS[source];
  if (!binding) return null;
  const Ctor = require(binding.module)[binding.ctor];
  return Ctor ? new Ctor({ maxRetries: 0, maxDetailPages: 0 }) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const argValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const apply = args.includes('--apply');
  // Default to every source that has a per-record probe, so this can be run
  // unattended after a sweep without anyone naming sources. An index sweep can
  // only refresh what the index currently lists; this covers the rest, and
  // it never retires anything, so running it repeatedly is safe.
  const requested = argValue('--source', null);
  const sources = (requested || Object.keys(SOURCE_SCRAPERS).join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);

  const baseUrl = process.env.PROPERTY_API_URL || 'http://localhost:3000';
  const storePath = resolveLiveStorePath(process.env.PROPERTY_LIVE_CACHE_PATH);

  let refreshedTotal = 0;
  let wrote = false;

  for (const source of sources) {
    const scraper = scraperFor(source);
    if (!scraper) {
      process.stdout.write(`${source}: no per-record refresh is implemented for this source\n`);
      continue;
    }
    const stale = await readStaleRecords(baseUrl, source);
    if (!stale.length) {
      process.stdout.write(`${source}: no stale records to refresh\n`);
      continue;
    }

    const result = await refreshKnownRecords({ source, scraper, records: stale });
    refreshedTotal += result.refreshed.length;

    process.stdout.write(
      `${source}: stale ${result.attempted}, refreshed ${result.refreshed.length}, ` +
      `publisher no longer serves ${result.notServed.length}, errors ${result.errored.length}\n`,
    );
    for (const failure of result.notServed) {
      process.stdout.write(`  NOT_SERVED ${failure.id} - reported only, not retired\n`);
    }
    for (const failure of result.errored) {
      process.stdout.write(`  ERROR       ${failure.id} - ${failure.detail}\n`);
    }

    if (apply && result.refreshed.length) {
      const listings = result.refreshed.map((entry) => entry.listing);
      // No runCompleted, so nothing is retired: this merges observations only.
      const merged = mergeLiveRecords(storePath, listings);
      wrote = true;
      process.stdout.write(
        `  wrote ${merged.accepted} refreshed records to ${storePath} ` +
        `(retained ${merged.retained}, retired ${merged.retired || 0})\n`,
      );
    }
  }

  process.stdout.write(
    apply
      ? `\n${refreshedTotal} record(s) refreshed${wrote ? ' and written to the live store' : ''}. ` +
        'Run `npm run db:import` to import them. Nothing was retired.\n'
      : `\n${refreshedTotal} record(s) would be refreshed. Re-run with --apply to write them.\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`refresh failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { readStaleRecords };
