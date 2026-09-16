#!/usr/bin/env node
'use strict';

/**
 * Audit the live listings table for data-quality hazards upstream of the
 * property-image route. Prints a summary to stdout and writes a full JSON
 * report to the path given by --out (default: .cache/property-image-audit.json).
 *
 * Usage:
 *   node scripts/audit-property-image-routing.cjs
 *       [--limit 100]            # sample size; default = all live rows
 *       [--threshold 0.05]       # fail-rate above this is a non-zero exit
 *       [--out .cache/foo.json]  # path for the full JSON report
 *       [--sources civilview,hud] # only audit these source adapters
 *
 * The audit is deterministic and offline — no network calls. The check
 * definitions live in server/audit/property-image-routing.js.
 */

const fs = require('fs');
const path = require('path');

const db = require('../server/db/client');
const { runAudit } = require('../server/audit/property-image-routing');

function usage() {
  return [
    'Usage: node scripts/audit-property-image-routing.cjs',
    '  [--limit N]            audit the first N live rows (default: all)',
    '  [--threshold X]        fail-rate over X exits non-zero (default: 0.05)',
    '  [--out PATH]           write JSON report to PATH',
    '                          (default: .cache/property-image-audit.json)',
    '  [--sources a,b,c]      only audit rows whose source adapter is in',
    '                          this comma-separated list',
    '  [--state XX[,YY...]]   only audit rows in the listed US states',
    '  [--quiet]              suppress the per-row summary block',
  ].join('\n');
}

function parseArgs(argv) {
  const values = { limit: Infinity, threshold: 0.05, out: '.cache/property-image-audit.json', quiet: false, sources: null, state: null };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (['--limit', '--threshold', '--out', '--sources', '--state'].includes(name)) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
      values[name.slice(2)] = argv[++index];
      continue;
    }
    if (name === '--quiet') { values.quiet = true; continue; }
    throw new Error(`Unknown argument: ${name}`);
  }
  if (values.limit !== undefined && values.limit !== Infinity) {
    const number = Number(values.limit);
    if (!Number.isInteger(number) || number < 1) throw new Error('--limit must be a positive integer');
    values.limit = number;
  }
  const threshold = Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('--threshold must be between 0 and 1');
  values.threshold = threshold;
  if (values.sources) values.sources = values.sources.split(',').map((s) => s.trim()).filter(Boolean);
  if (values.state) values.state = values.state.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return values;
}

async function loadListings({ limit, sources, state }) {
  const batchSize = 1000;
  const collected = [];
  let offset = 0;
  // Pull in pages of 1000 until we have enough or we run dry. This is the
  // simplest way to get a stable sample without depending on the DB layer
  // exposing a random-sample primitive.
  while (collected.length < limit) {
    const page = Math.min(batchSize, limit - collected.length);
    const filters = { limit: page, offset, sort: 'score' };
    const { listings } = await db.getListings(filters);
    if (!listings || listings.length === 0) break;
    let pageRows = listings;
    if (sources && sources.length) pageRows = pageRows.filter((r) => sources.includes(r.source));
    if (state && state.length) pageRows = pageRows.filter((r) => state.includes((r.state || '').toUpperCase()));
    collected.push(...pageRows);
    if (listings.length < page) break;
    offset += listings.length;
  }
  return collected.slice(0, limit);
}

function renderSummary(report) {
  const lines = [];
  lines.push(`Property-image routing audit — ${report.total} listings`);
  lines.push(`  fail rate (any check): ${(report.fail_rate * 100).toFixed(2)}%  (${report.rows_with_fail}/${report.total})  threshold: ${(report.threshold * 100).toFixed(2)}%  ${report.above_threshold ? 'ABOVE' : 'within'}`);
  lines.push('');
  lines.push('  per-check:');
  for (const [name, summary] of Object.entries(report.by_check)) {
    const total = summary.pass + summary.fail + summary.skipped;
    const passStr = summary.pass.toString().padStart(6);
    const failStr = summary.fail.toString().padStart(6);
    const skippedStr = summary.skipped.toString().padStart(6);
    lines.push(`    ${name.padEnd(34)} pass=${passStr} fail=${failStr} skipped=${skippedStr} (of ${total})`);
  }
  lines.push('');
  lines.push('  per-source:');
  const sourceKeys = Object.keys(report.by_source).sort((a, b) => report.by_source[b].total - report.by_source[a].total);
  for (const key of sourceKeys) {
    const bucket = report.by_source[key];
    lines.push(`    ${key.padEnd(14)} total=${bucket.total.toString().padStart(5)} with_fail=${bucket.with_fail.toString().padStart(5)} (${(bucket.fail_rate * 100).toFixed(2)}%)`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const listings = await loadListings(args);
    if (listings.length === 0) {
      console.error('No listings matched the filter.');
      process.exitCode = 2;
      return;
    }
    const report = runAudit(listings, { threshold: args.threshold });
    if (!args.quiet) {
      process.stdout.write(`${renderSummary(report)}\n`);
      const failing = report.rows.filter((r) => r.fail > 0);
      if (failing.length) {
        process.stdout.write('\n  first failing rows:\n');
        for (const row of failing.slice(0, 20)) {
          const reasons = Object.entries(row.results)
            .filter(([, v]) => !v.ok)
            .map(([k, v]) => `${k}=${v.reason}`)
            .join('; ');
          process.stdout.write(`    ${row.id} (${row.source}): ${reasons}\n`);
        }
        if (failing.length > 20) process.stdout.write(`    ... and ${failing.length - 20} more (see --out report)\n`);
      }
    }
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!args.quiet) process.stdout.write(`\nFull report: ${args.out}\n`);
    if (report.above_threshold) process.exitCode = 1;
  })().catch((error) => {
    console.error(`${error.code || 'AUDIT_ERROR'}: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, loadListings, renderSummary };