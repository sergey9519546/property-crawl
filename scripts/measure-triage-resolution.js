#!/usr/bin/env node
'use strict';

// scripts/measure-triage-resolution.js
//
// Repeatable evidence for the opportunity-signal evaluator's live resolution
// rates. The 2026-10-21 defect report re-measured the score distribution by
// hand; this script makes the same measurement a command so the
// assessor-enrollment expansion (Task: 15+ counties) can be judged on a
// before/after delta instead of a one-off reading.
//
// Measured per the live listing set, with Postgres observation history
// (migrations 025 + 027):
//   - records carrying a direct publisher estLow/estHigh band;
//   - records carrying a harvested assessor roll (provenance.derivedFields.assessorRoll);
//   - bid_to_value_ratio supported rate, split by evidenceClass
//     (official_parcel_roll / macro_housing_index / calculated_ratio);
//   - supported counts for bid_reduction and returned_to_market;
//   - triage_priority distribution against src/lib/triage-bands.ts;
//   - per-county roll coverage, to choose the next enrollment candidates.
//
// Usage: node scripts/measure-triage-resolution.js [--limit N] [--json]

const path = require('node:path');

function parseArgs(argv) {
  const options = { limit: 0, json: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--limit') options.limit = Math.max(1, Number.parseInt(argv[++index], 10) || 0);
    else if (flag === '--json') options.json = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

function emptyBuckets() {
  return { official_parcel_roll: 0, macro_housing_index: 0, calculated_ratio: 0 };
}

if (require.main === module) main().catch((error) => {
  console.error('[measure-triage-resolution]', error.message);
  process.exitCode = 1;
});

module.exports = { parseArgs, emptyBuckets };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = require('../server/db/client');
  await db.verifyConnection();
  if (!db.isPg || !db.pool) {
    throw new Error('Measurement requires PostgreSQL (DATABASE_URL). There is no demo inventory to measure.');
  }
  const { loadObservationsForRecord } = require('../server/db/observations-persistence');
  const { evaluateOpportunitySignals } = require('../server/intelligence/signals');

  const totalRow = await db.pool.query('SELECT count(*)::int AS total FROM listings');
  const total = Number(totalRow.rows[0]?.total) || 0;
  const limit = options.limit || total;

  // Paginate through listings; measure every one up to the limit.
  const pageSize = 500;
  const counters = {
    listingsMeasured: 0,
    directValuationBand: 0,
    assessorRollHarvested: 0,
    ratio: { supported: 0, contradicted: 0, unknown: 0, byEvidenceClass: emptyBuckets() },
    bidReduction: { supported: 0 },
    returnedToMarket: { supported: 0 },
    triage: { zero: 0, low: 0, moderate: 0, high: 0, max: 0 },
    triageSum: 0,
    triageMax: 0,
    byCounty: {},
  };

  for (let offset = 0; offset < limit; offset += pageSize) {
    // 'score' (the default) ends in `id ASC`, so pagination is deterministic.
    const page = await db.getListings({ limit: Math.min(pageSize, limit - offset), offset, sort: 'score' });
    const listings = page.listings || [];
    if (!listings.length) break;
    for (const listing of listings) {
      counters.listingsMeasured += 1;
      const hasBand = Number.isFinite(Number(listing.estLow)) && Number(listing.estLow) > 0
        && Number.isFinite(Number(listing.estHigh)) && Number(listing.estHigh) >= Number(listing.estLow);
      if (hasBand) counters.directValuationBand += 1;
      const roll = listing.provenance?.derivedFields?.assessorRoll;
      if (roll) {
        counters.assessorRollHarvested += 1;
        const countyKey = roll.countyKey || 'UNKNOWN';
        const bucket = counters.byCounty[countyKey] ||= { listings: 0, rolls: 0 };
        bucket.rolls += 1;
      }
      let observations = { records: {}, signals: [] };
      let historyUnavailable = false;
      try {
        observations = await loadObservationsForRecord(db.pool, listing);
      } catch (_) { historyUnavailable = true; }

      const evaluation = evaluateOpportunitySignals(listing, { observations, historyUnavailable });
      const ratio = evaluation.signals.find((signal) => signal.key === 'bid_to_value_ratio');
      counters.ratio[ratio.status] += 1;
      if (ratio.status !== 'unknown' && counters.ratio.byEvidenceClass[ratio.evidenceClass] !== undefined) {
        counters.ratio.byEvidenceClass[ratio.evidenceClass] += 1;
      }
      if (evaluation.signals.find((signal) => signal.key === 'bid_reduction')?.status === 'supported') counters.bidReduction.supported += 1;
      if (evaluation.signals.find((signal) => signal.key === 'returned_to_market')?.status === 'supported') counters.returnedToMarket.supported += 1;

      const priority = evaluation.triagePriority || 0;
      counters.triageSum += priority;
      counters.triageMax = Math.max(counters.triageMax, priority);
      if (priority === 0) counters.triage.zero += 1;
      else if (priority < 30) counters.triage.low += 1;
      else if (priority < 50) counters.triage.moderate += 1;
      else if (priority < 70) counters.triage.high += 1;
      else counters.triage.max += 1;

      if (roll) {
        const bucket = counters.byCounty[roll.countyKey || 'UNKNOWN'];
        bucket.listings = bucket.listings || 0;
      } else {
        // Track enrollment candidates by county even without a roll.
        const countyKey = require('../server/enrichment/arcgis-parcels').resolveCountyKey(listing.state, listing.county) || 'unenrolled';
        const bucket = counters.byCounty[countyKey] ||= { listings: 0, rolls: 0 };
        bucket.listings += 1;
      }
    }
    if (options.limit && counters.listingsMeasured >= options.limit) break;
    if (!page.total || offset + pageSize >= page.total) break;
  }

  const avg = counters.listingsMeasured ? Number((counters.triageSum / counters.listingsMeasured).toFixed(2)) : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    listingsMeasured: counters.listingsMeasured,
    storeListings: total,
    directValuationBand: counters.directValuationBand,
    assessorRollHarvested: counters.assessorRollHarvested,
    ratioComponent: counters.ratio,
    bidReductionSupported: counters.bidReduction.supported,
    returnedToMarketSupported: counters.returnedToMarket.supported,
    triage: { ...counters.triage, avg, max: counters.triageMax },
    countyCoverage: Object.fromEntries(Object.entries(counters.byCounty).sort((a, b) => b[1].listings - a[1].listings)),
    note: 'Resolution evidence only. Not a valuation, likelihood, or distress prediction.',
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = [
      `Listings measured: ${report.listingsMeasured} of ${report.storeListings}`,
      `Direct publisher valuation bands (estLow/estHigh): ${report.directValuationBand}`,
      `Harvested assessor rolls: ${report.assessorRollHarvested}`,
      `Ratio component: supported=${report.ratioComponent.supported} contradicted=${report.ratioComponent.contradicted} unknown=${report.ratioComponent.unknown}`,
      `  by evidenceClass: ${JSON.stringify(report.ratioComponent.byEvidenceClass)}`,
      `bid_reduction supported: ${report.bidReductionSupported}`,
      `returned_to_market supported: ${report.returnedToMarketSupported}`,
      `triage distribution: ${JSON.stringify(report.triage)}`,
      'County coverage (listings without roll = enrollment candidates):',
    ];
    for (const [countyKey, bucket] of Object.entries(report.countyCoverage).slice(0, 25)) {
      lines.push(`  ${countyKey}: listings=${bucket.listings} rolls=${bucket.rolls}`);
    }
    console.log(lines.join('\n'));
  }
}

