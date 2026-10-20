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
const {
  EmailNoticesPipeline,
  collectEmailNotices,
  ImapCredentialsUnsetError,
  PRESS_ASSOCIATION_DOMAINS,
} = require('../server/sources/email-notices');

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
  node scripts/collect-email-notices.js --imap           Fetch operator mailbox via EmailNoticesPipeline (requires IMAP_*)
  node scripts/collect-email-notices.js --status         Show configuration and store path
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
      host: cfg.host || process.env.IMAP_HOST || null,
      mailbox: cfg.mailbox || process.env.IMAP_MAILBOX || 'INBOX',
      corpusDir: process.env.IMAP_CORPUS_DIR || null,
      storePath,
      storeExists: fs.existsSync(storePath),
      keywords: cfg.keywords,
      pressDomains: PRESS_ASSOCIATION_DOMAINS,
    }, null, 2));
    process.exit(0);
  }

  if (!flags.corpus && !flags.imap) {
    usage();
    console.error('Choose --corpus or --imap (or --status).');
    process.exit(2);
  }

  if (flags.imap && !flags.corpus) {
    // Phase 2 canonical IMAP pipeline with statewide press association domain query and standard ingestion
    const pipeline = new EmailNoticesPipeline({ env: process.env });
    if (!pipeline.isConfigured()) {
      const err = new ImapCredentialsUnsetError();
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }

    try {
      const result = await pipeline.ingest();
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok || result.errors.length > 0) {
        process.exitCode = 1;
      }
      return;
    } catch (err) {
      if (err.code === 'IMAP_CREDENTIALS_UNSET' || err instanceof ImapCredentialsUnsetError) {
        console.error(`[${err.code}] ${err.message}`);
      } else {
        console.error(`IMAP collection failed: ${err.message}`);
      }
      process.exit(1);
    }
  }

  // Corpus path fallback
  const scraper = new PublicNoticesEmailScraper({
    env: process.env,
    corpusDir: flags.corpus || process.env.IMAP_CORPUS_DIR || '',
  });

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

module.exports = { main, parseArgs, usage };
