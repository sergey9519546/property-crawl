#!/usr/bin/env node
'use strict';

const db = require('../server/db/client');
const { repairLiveEnrichment } = require('../server/enrichment/repair-live-enrichment');

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: true,
    njLimit: 40,
    geocodeLimit: 60,
    maxDurationMs: 60_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--nj-limit' && argv[i + 1]) options.njLimit = Number(argv[++i]);
    else if (arg === '--geocode-limit' && argv[i + 1]) options.geocodeLimit = Number(argv[++i]);
    else if (arg === '--max-duration-ms' && argv[i + 1]) options.maxDurationMs = Number(argv[++i]);
  }
  return options;
}

async function main() {
  const opts = parseCliArgs();
  if (!db.isPg || !db.pool) {
    throw new Error('DATABASE_URL must be configured to run live enrichment repair against PostgreSQL');
  }
  try {
    const report = await repairLiveEnrichment({ db, pool: db.pool, ...opts });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (typeof db.close === 'function') await db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[repair-live-enrichment] failed:', err?.message || err);
    process.exit(1);
  });
}

module.exports = { parseCliArgs, main };
