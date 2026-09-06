'use strict';
/**
 * seed-from-v0.js — Seed PostgreSQL/PostGIS database from v0 data.js
 *
 * Implements Task 3.1 from docs/superpowers/plans/2026-08-31-ship-property-crawl.md:
 * Seeds persistent PostgreSQL database from canonical v0 records in data.js.
 *
 * Usage:
 *   node scripts/seed-from-v0.js --dry-run        # Validate and preview without writing to database
 *   node scripts/seed-from-v0.js --init-schema    # Run schema.sql before seeding
 *   node scripts/seed-from-v0.js                  # Run seeding using DATABASE_URL
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.js');
const SCHEMA_PATH = path.join(ROOT, 'server/db/schema.sql');

function loadV0Data() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Seed data file not found at ${DATA_PATH}`);
  }
  const sandbox = { window: {}, Math };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(DATA_PATH, 'utf8'), sandbox);

  const sources = sandbox.window.SOURCES || {};
  const listings = sandbox.window.LISTINGS || [];
  return { sources, listings };
}

async function seedFromV0(options = {}) {
  const {
    databaseUrl = process.env.DATABASE_URL,
    dryRun = false,
    initSchema = false,
    logger = console.log,
  } = options;

  const { sources, listings } = loadV0Data();
  const sourceKeys = Object.keys(sources);

  logger(`[Seed v0] Found ${sourceKeys.length} sources and ${listings.length} listings in data.js`);

  if (dryRun || !databaseUrl) {
    logger('[Seed v0] Running in dry-run mode (no database mutations applied).');
    const states = new Set(listings.map(l => l.state).filter(Boolean));
    const withCoords = listings.filter(l => l.lat != null && l.lng != null).length;
    return {
      success: true,
      dryRun: true,
      sourcesCount: sourceKeys.length,
      listingsCount: listings.length,
      statesCount: states.size,
      geocodedCount: withCoords,
      message: dryRun
        ? 'Dry run validation succeeded.'
        : 'DATABASE_URL is unset. Seed validated successfully in preview mode.',
    };
  }

  // Connect to PostgreSQL
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const client = await pool.connect();
    try {
      if (initSchema) {
        logger('[Seed v0] Executing server/db/schema.sql...');
        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
        await client.query(schemaSql);
        logger('[Seed v0] Schema initialized successfully.');
      }

      await client.query('BEGIN');

      // Seed sources
      let sourcesSeeded = 0;
      for (const [key, s] of Object.entries(sources)) {
        await client.query(
          `INSERT INTO sources (key, label, tier, color, note, website_url, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT (key) DO UPDATE SET
             label = EXCLUDED.label,
             tier = EXCLUDED.tier,
             color = EXCLUDED.color,
             note = EXCLUDED.note,
             website_url = EXCLUDED.website_url,
             updated_at = NOW()`,
          [key, s.label || key, s.tier || 1, s.color || '#64748B', s.note || '', s.websiteUrl || null]
        );
        sourcesSeeded++;
      }

      // Seed listings via DatabaseClient projection
      const dbClient = require('../server/db/client');
      let listingsSeeded = 0;
      for (const listing of listings) {
        const prepared = dbClient.prepareListingForPersistence(listing);
        await dbClient.createListing(prepared);
        listingsSeeded++;
      }

      await client.query('COMMIT');
      logger(`[Seed v0] Successfully committed ${sourcesSeeded} sources and ${listingsSeeded} listings.`);

      const verifyRes = await client.query('SELECT count(*) AS count FROM listings');
      const verifiedCount = Number(verifyRes.rows[0]?.count || 0);

      return {
        success: true,
        dryRun: false,
        sourcesSeeded,
        listingsSeeded,
        verifiedCount,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const initSchema = args.includes('--init-schema');

  try {
    const result = await seedFromV0({ dryRun, initSchema });
    if (result.dryRun) {
      console.log(`✅ ${result.message}`);
      console.log(`   Sources: ${result.sourcesCount}`);
      console.log(`   Listings: ${result.listingsCount} (${result.geocodedCount} geocoded across ${result.statesCount} states)`);
    } else {
      console.log(`✅ Seeding complete: ${result.listingsSeeded} listings seeded (DB total: ${result.verifiedCount})`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`❌ Seeding failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { seedFromV0, loadV0Data };
if (require.main === module) main();
