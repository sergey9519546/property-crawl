'use strict';

/**
 * Fixture listings for browser/HTTP journeys that need a real feed.
 *
 * Both the production e2e and the Playwright suite boot a stack against an
 * isolated embedded database and need rows in it. They share this definition so
 * the two cannot drift into testing different data.
 *
 * These are NOT inventory and must never reach a real database: they carry
 * `production-e2e` in their ids and provenance, and the only caller is a test
 * harness pointing at a temp directory.
 *
 * Enough rows for a feed, a filter and a detail page to mean something: several
 * sources, several states and counties, and a deliberate spread of opening bids
 * against estimate bands so the quality and opportunity sorts have an ordering
 * to produce rather than five identical scores.
 */

const MARKETS = [
  { source: 'servicelink', state: 'PA', county: 'Erie',     city: 'Erie',        lat: 42.1354, lng: -80.0603 },
  { source: 'hud',         state: 'OH', county: 'Cuyahoga',  city: 'Cleveland',   lat: 41.4993, lng: -81.6944 },
  { source: 'civilview',   state: 'NJ', county: 'Camden',    city: 'Camden',      lat: 39.9259, lng: -75.1195 },
  { source: 'civilview',   state: 'NJ', county: 'Essex',     city: 'Newark',      lat: 40.7357, lng: -74.1724 },
  { source: 'treasury',    state: 'CA', county: 'Los Angeles', city: 'Los Angeles', lat: 34.0611, lng: -118.2384 },
  { source: 'usda',        state: 'IA', county: 'Polk',      city: 'Des Moines',  lat: 41.5868, lng: -93.6250 },
  { source: 'gsa',         state: 'TX', county: 'Harris',    city: 'Houston',     lat: 29.7604, lng: -95.3698 },
  { source: 'courtlistener', state: 'FL', county: 'Orange',  city: 'Orlando',     lat: 28.5383, lng: -81.3792 },
];

// openingBid / (mid) -> deal score, so the sorts have a real spread.
const BANDS = [
  { openingBid: 25000, estLow: 60000, estHigh: 90000 },
  { openingBid: 41000, estLow: 95000, estHigh: 140000 },
  { openingBid: 15000, estLow: 80000, estHigh: 120000 },
  { openingBid: 62000, estLow: 70000, estHigh: 90000 },
  { openingBid: 95000, estLow: 300000, estHigh: 420000 },
  { openingBid: 18500, estLow: 55000, estHigh: 72000 },
  { openingBid: 71000, estLow: 88000, estHigh: 96000 },
  { openingBid: 33000, estLow: 120000, estHigh: 185000 },
];

function buildFixtures() {
  const now = new Date().toISOString();
  return MARKETS.map((market, i) => {
    const band = BANDS[i % BANDS.length];
    return {
      id: `fixture:${market.source}:${i + 1}`,
      ...market,
      address: `${100 + i} E2E ${market.street || 'Street'}, ${market.city}, ${market.state}`,
      ...band,
      status: 'active',
      saleDate: `2026-${String(11 + (i % 2)).padStart(2, '0')}-15`,
      photo: null,
      observedAt: now,
    };
  });
}

async function seedFixtures(pool) {
  const fixtures = buildFixtures();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of fixtures) {
      await client.query(
        `INSERT INTO listings (id, source_key, state, county, city, address, latitude, longitude,
           geog, opening_bid, est_low, est_high, deal_score, sale_date, photo_url, status,
           source_observed_at, fetched_at, provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
           ST_SetSRID(ST_MakePoint($8,$7),4326)::geography,
           $9,$10,$11,
           CASE WHEN $9::numeric IS NOT NULL AND $10::numeric IS NOT NULL
             THEN GREATEST(1, LEAST(99, ROUND((1 - ($9 / (($10+$11)/2)))*130)::int)) END,
           $12,$13,$14,$15,$16,
           $17::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [f.id, f.source, f.state, f.county, f.city, f.address, f.lat, f.lng,
          f.openingBid, f.estLow, f.estHigh, f.saleDate, f.photo, 'active',
          f.observedAt, f.observedAt,
          JSON.stringify({ origin: 'live', recordKind: 'source_record', publisher: 'test fixture' })]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return fixtures.length;
}

/** Create (or open) an isolated embedded database at `dataDir` and seed it. */
async function seedIsolatedDatabase(dataDir, log = () => {}) {
  const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
  const { migrate } = require('./discovery-migrate');
  const { pool } = await startEmbeddedPostgres({ dataDir, log });
  try {
    await migrate(pool);
    return await seedFixtures(pool);
  } finally {
    await pool.end();
  }
}

module.exports = { seedFixtures, seedIsolatedDatabase, buildFixtures };