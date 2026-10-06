'use strict';

/**
 * Remove listings whose opportunity has already concluded, and report what is
 * left with a reason.
 *
 * Reads the real rule from server/db/listing-lifecycle.js - this script only
 * applies it. Nothing is deleted on the strength of an observation being old:
 * every record in the store is 16+ days old because the collector has not run,
 * and that is reported as a freshness gap, not used as a per-row verdict.
 *
 *   node scripts/db-prune-ended.js            dry run: decide and print, delete nothing
 *   node scripts/db-prune-ended.js --apply    delete, inside one transaction
 */

const fs = require('node:fs');
const path = require('node:path');
const { classifyListing } = require('../server/db/listing-lifecycle');

const LEDGER_PATH = path.resolve(__dirname, '../reports/pruned-listings.json');

async function openPool() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    return { pool: new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }), external: true };
  }
  const { startEmbeddedPostgres } = require('../server/db/pglite-pool');
  const started = await startEmbeddedPostgres({ log: console.log });
  const { migrate } = require('./discovery-migrate');
  await migrate(started.pool);
  return { pool: started.pool, external: false };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const now = Date.now();
  const { pool, external } = await openPool();

  const rows = (await pool.query(
    `SELECT id, source_key, lifecycle_status, status, sale_date, source_observed_at, raw_notice
       FROM listings`
  )).rows;

  const decided = rows.map(row => ({ row, decision: classifyListing(row, now) }));
  const concluded = decided.filter(d => d.decision.concluded);
  const kept = decided.filter(d => !d.decision.concluded);

  const byVerdict = new Map();
  for (const d of concluded) byVerdict.set(d.decision.verdict, (byVerdict.get(d.decision.verdict) || 0) + 1);
  const byKeptReason = new Map();
  for (const d of kept) byKeptReason.set(d.decision.verdict, (byKeptReason.get(d.decision.verdict) || 0) + 1);
  const keptBySource = new Map();
  for (const d of kept) keptBySource.set(d.row.source_key, (keptBySource.get(d.row.source_key) || 0) + 1);

  const observedTimes = rows
    .map(r => Date.parse(r.source_observed_at || ''))
    .filter(Number.isFinite);

  const report = {
    decidedAt: new Date(now).toISOString(),
    applied: false,
    totalBefore: rows.length,
    removed: [],
    removedCount: 0,
    removedByVerdict: Object.fromEntries(byVerdict),
    keptCount: kept.length,
    keptByReason: Object.fromEntries(byKeptReason),
    keptBySource: Object.fromEntries(keptBySource),
    conflictingKept: kept.filter(d => d.decision.note).map(d => ({
      id: d.row.id, source: d.row.source_key, status: d.row.lifecycle_status, why: d.decision.note,
    })),
    // Not a reason to delete anything, but it must not be invisible: the whole
    // store is one collector-cycle behind.
    collectionFreshness: {
      oldestObservation: observedTimes.length ? new Date(Math.min(...observedTimes)).toISOString() : null,
      newestObservation: observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null,
      note: 'Every record predates this run. The collector has not run since the newest observation above; nothing here was re-observed to decide it.',
    },
  };

  console.log(`[prune] ${rows.length} listings examined`);
  console.log(`[prune] ${concluded.length} concluded, ${kept.length} kept`);
  console.log('\nremoved by reason:');
  for (const [k, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log('\nkept by reason:');
  for (const [k, n] of [...byKeptReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log('\nkept by source:');
  for (const [k, n] of [...keptBySource].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  if (report.conflictingKept.length) {
    console.log(`\n${report.conflictingKept.length} kept despite a signal that could have removed them:`);
    for (const c of report.conflictingKept.slice(0, 5)) console.log(`  ${c.id} — ${c.why}`);
    if (report.conflictingKept.length > 5) console.log(`  ... and ${report.conflictingKept.length - 5} more`);
  }

  if (!apply) {
    console.log('\n[prune] dry run - nothing was deleted. Re-run with --apply to delete.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    for (const d of concluded) {
      await client.query('DELETE FROM listings WHERE id = $1', [d.row.id]);
      deleted++;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[prune] rolled back after ${deleted} deletions - ${error.message}`);
    client.release();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  client.release();

  report.applied = true;
  report.removedCount = deleted;
  report.removed = concluded.map(d => ({
    id: d.row.id, source: d.row.source_key, verdict: d.decision.verdict, evidence: d.decision.label,
  }));
  const after = await pool.query('SELECT count(*)::int AS n FROM listings');
  report.totalAfter = after.rows[0].n;

  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(report, null, 2));
  console.log(`\n[prune] deleted ${deleted} concluded listings; ${report.totalAfter} remain`);
  console.log(`[prune] ledger written to ${path.relative(process.cwd(), LEDGER_PATH)}`);

  await pool.end();
}

if (require.main === module) {
  main().catch(e => { console.error('[prune] failed:', e.message); process.exitCode = 1; });
}

module.exports = { main };