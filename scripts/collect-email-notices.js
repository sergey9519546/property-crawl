'use strict';
/**
 * scripts/collect-email-notices.js — CLI for press-association email ingestion.
 *
 * Usage:
 *   node scripts/collect-email-notices.js --corpus test/fixtures/email-notices
 *   node scripts/collect-email-notices.js --imap
 *   node scripts/collect-email-notices.js --status
 */

const fs = require('fs');
const path = require('path');
const {
  PublicNoticesEmailScraper,
  envConfig,
  isConfigured,
  DEFAULT_STORE_PATH,
} = require('../server/scrapers/email-ingest');

function parseArgs(argv) {
  const flags = { corpus: '', imap: false, status: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--imap') flags.imap = true;
    else if (arg === '--status') flags.status = true;
    else if (arg.startsWith('--corpus=')) flags.corpus = arg.slice('--corpus='.length);
    else if (arg === '--corpus') {
      flags.corpus = argv[i + 1] || '';
      i += 1;
    }
  }
  return flags;
}

function usage() {
  console.log(`Press-association email notice ingestion (docs/STRATEGY.md Hack #1)

  node scripts/collect-email-notices.js --corpus <dir>   Parse local .eml/.txt fixtures
  node scripts/collect-email-notices.js --imap           Fetch operator mailbox (requires IMAP_*)
  node scripts/collect-email-notices.js --status         Show configuration and store path

Evidence packets are discovery-only. They never auto-publish as live listings.
`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    usage();
    process.exit(0);
  }

  const cfg = envConfig(process.env);
  const storePath = cfg.storePath || DEFAULT_STORE_PATH;

  if (flags.status) {
    console.log(JSON.stringify({
      imapConfigured: isConfigured(process.env),
      host: cfg.host || null,
      mailbox: cfg.mailbox,
      corpusDir: process.env.IMAP_CORPUS_DIR || null,
      storePath,
      storeExists: fs.existsSync(storePath),
      keywords: cfg.keywords,
    }, null, 2));
    process.exit(0);
  }

  if (!flags.corpus && !flags.imap) {
    usage();
    console.error('Choose --corpus or --imap (or --status).');
    process.exit(2);
  }

  const scraper = new PublicNoticesEmailScraper({
    env: process.env,
    corpusDir: flags.corpus || process.env.IMAP_CORPUS_DIR || '',
  });

  if (flags.imap && !flags.corpus) {
    // Force IMAP path only.
    scraper.corpusDir = '';
    if (!isConfigured(process.env)) {
      console.error('IMAP is not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASS (and optionally IMAP_PORT, IMAP_TLS, IMAP_MAILBOX).');
      process.exit(1);
    }
  }

  const result = await scraper.scrapeFeed();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.error) process.exitCode = 1;
  if (result.error === 'imap_not_configured') process.exitCode = 1;
  if (result.accepted === 0 && flags.corpus) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
