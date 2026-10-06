'use strict';

/**
 * Load the live record store into PostgreSQL.
 *
 * The scrapers write `.cache/live-listings.json`. That file was the only place
 * the inventory existed, because there was no database to put it in. This moves
 * it into real rows, through the same canonicaliser the runtime write path
 * uses, so what lands in the table is what the API would have accepted.
 *
 * Refuses to invent a source. `listings.source_key` REFERENCES sources(key),
 * and the store carries records from `fl-dor-cadastral` and `courtlistener`,
 * which the seeded catalog does not define. Rather than drop them or invent a
 * catalog row, this reports them and stops - a missing source is a fact about
 * the catalog that a human should resolve.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STORE = path.resolve(ROOT, '.cache/live-listings.json');

function loadStore(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : (parsed.listings || []);
}

/** Records the catalog cannot accept, grouped by the source key that is missing. */
function findMissingSources(records, pool) {
  const used = new Set(records.map(r => r.source).filter(Boolean));
  return used;
}

// One spec drives the column list, the placeholders and the parameter array, so
// a column and its value can never drift apart. Getting this wrong produced
// "INSERT has more target columns than expressions", which is loud, but only
// after counting three lists by hand.
const INSERTABLE = [
  ['id', r => r.id],
  ['source_key', r => r.source],
  ['state', r => r.state],
  ['county', r => r.county],
  ['city', r => r.city],
  ['zip', r => r.zip],
  ['address', r => r.address],
  ['latitude', r => r.lat],
  ['longitude', r => r.lng],
  ['beds', r => r.beds],
  ['baths', r => r.baths],
  ['sqft', r => r.sqft],
  ['year_built', r => r.year],
  ['prop_type', r => r.propType],
  ['opening_bid', r => r.openingBid],
  ['est_low', r => r.estLow],
  ['est_high', r => r.estHigh],
  ['assessed_value', r => r.assessed],
  ['deal_score', r => r.dealScore],
  ['sale_date', r => r.saleDate],
  ['plaintiff', r => r.plaintiff],
  ['defendant', r => r.defendant],
  ['judgment_amount', r => r.judgment],
  ['attorney', r => r.attorney],
  ['occupancy', r => r.occupancy],
  ['deposit_terms', r => r.deposit],
  ['photo_url', r => r.photo],
  ['images', r => r.images],
  ['source_url', r => r.sourceUrl],
  ['raw_notice', r => r.raw],
  ['provenance', r => (r.provenance ? JSON.stringify(r.provenance) : null), 'jsonb'],
  ['source_observed_at', r => r.sourceObservedAt],
  ['fetched_at', r => r.fetchedAt],
  ['price', r => r.price],
  ['listing_date', r => r.listingDate],
  ['redemption_days', r => r.redemptionDays],
  ['redemption_warning', r => r.redemptionWarning],
  ['senior_lien_risk', r => r.seniorLienRisk],
  ['senior_lien_warning', r => r.seniorLienWarning],
  ['cash_to_close', r => r.cashToClose],
  ['cash_to_close_details', r => (r.cashToCloseDetails ? JSON.stringify(r.cashToCloseDetails) : null), 'jsonb'],
  ['status', r => r.status],
  ['auction_program', r => r.auctionProgram],
  ['lifecycle_status', r => r.lifecycleStatus],
  ['transaction_outcome', r => r.transactionOutcome],
];

const COLUMNS_SQL = INSERTABLE.map(([name]) => name).join(', ');

const INSERT_SQL =
  `INSERT INTO listings (${COLUMNS_SQL}, geog) VALUES (${INSERTABLE
    .map((_, i) => `$${i + 1}`)
    .join(', ')}, CASE WHEN $8::float8 IS NULL OR $9::float8 IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END)
   ON CONFLICT (id) DO UPDATE SET
     source_observed_at = EXCLUDED.source_observed_at,
     status            = EXCLUDED.status,
     provenance        = EXCLUDED.provenance,
     raw_notice        = EXCLUDED.raw_notice,
     source_url        = EXCLUDED.source_url,
     deal_score        = EXCLUDED.deal_score`;

function paramsFor(record) {
  return INSERTABLE.map(([, pick]) => pick(record));
}

async function main() {
  const file = process.env.PROPERTY_LIVE_CACHE_PATH
    ? path.resolve(process.env.PROPERTY_LIVE_CACHE_PATH)
    : DEFAULT_STORE;
  if (!fs.existsSync(file)) {
    console.error(`No live record store at ${file}`);
    process.exitCode = 1;
    return;
  }

  const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
  const { migrate } = require('./discovery-migrate');
  const { prepareListingForPersistence } = require('../server/db/client');

  const { pool, dataDir } = await startEmbeddedPostgres({
    log: console.log,
    dataDir: process.env.PROPERTY_PG_DATA_DIR || undefined,
  });
  await migrate(pool);
  console.log(`[import] migrations applied at ${dataDir}`);

  const records = loadStore(file);
  console.log(`[import] ${records.length} records read from ${path.basename(file)}`);

  const known = new Set(
    (await pool.query('SELECT key FROM sources')).rows.map(r => r.key)
  );
  const unknownSources = {};
  for (const r of records) {
    if (r.source && !known.has(r.source)) {
      unknownSources[r.source] = (unknownSources[r.source] || 0) + 1;
    }
  }
  if (Object.keys(unknownSources).length) {
    console.error('[import] the catalog has no row for these source keys; listings.source_key is a foreign key.');
    for (const [key, n] of Object.entries(unknownSources)) {
      console.error(`  ${key}: ${n} records`);
    }
    console.error('[import] nothing was written. Add the sources to server/db/schema.sql, then re-run.');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  // One transaction for the whole import: a half-loaded inventory would look
  // like a smaller real one.
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await client.query(INSERT_SQL, paramsFor(prepareListingForPersistence(record)));
      written++;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[import] rolled back after', written, 'of', records.length, '-', error.message);
    client.release();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  client.release();

  const total = await pool.query('SELECT count(*)::int AS n FROM listings');
  const bySource = await pool.query(
    'SELECT source_key, count(*)::int AS n FROM listings GROUP BY source_key ORDER BY n DESC');
  console.log(`[import] wrote ${written} rows`);
  console.log(`[import] listings table now holds ${total.rows[0].n}`);
  for (const row of bySource.rows) console.log(`  ${String(row.n).padStart(6)} ${row.source_key}`);

  const oldest = await pool.query(
    'SELECT min(source_observed_at)::text AS oldest, max(source_observed_at)::text AS newest FROM listings');
  console.log(`[import] observed ${oldest.rows[0].oldest} .. ${oldest.rows[0].newest}`);

  await pool.end();
}

if (require.main === module) {
  main().catch(e => { console.error('[import] failed:', e.message); process.exitCode = 1; });
}

module.exports = { loadStore };