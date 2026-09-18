'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseRfc822,
  messageToPackets,
  ingestEmlDirectory,
  ingestImapMailbox,
  isConfigured,
  PublicNoticesEmailScraper,
  writePackets,
  DEFAULT_KEYWORDS,
} = require('../server/scrapers/email-ingest');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'email-notices');

test('parseRfc822 extracts subject, from, and body text', () => {
  const raw = [
    'From: alerts@example.com',
    'Subject: Sheriff\'s Sale Notice',
    'Message-ID: <abc@example>',
    '',
    'NOTICE OF SHERIFF\'S SALE Case No. 2024-CV-1',
  ].join('\n');
  const parsed = parseRfc822(raw);
  assert.equal(parsed.subject, "Sheriff's Sale Notice");
  assert.equal(parsed.from, 'alerts@example.com');
  assert.ok(/Case No\./i.test(parsed.body));
});

test('messageToPackets requires keyword match and stays evidence-only', () => {
  const matched = messageToPackets({
    subject: 'Notice of Foreclosure Sale',
    body: 'Judgment: $10,000 Opening bid: $1,000 Sale Date: October 1, 2026 1 Main St, Akron, OH 44301',
    messageId: '<x@y>',
  }, { keywords: DEFAULT_KEYWORDS });
  assert.equal(matched.matched, true);
  assert.ok(matched.packets.length >= 1);
  assert.equal(matched.packets[0].publicationStatus, 'evidence_only');
  assert.equal(matched.packets[0].sourceKey, 'public-notices-email');

  const unmatched = messageToPackets({
    subject: 'Weekly newsletter',
    body: 'Thanks for reading our marketing update.',
  });
  assert.equal(unmatched.matched, false);
  assert.equal(unmatched.packets.length, 0);
});

test('ingestEmlDirectory parses local corpus fixtures', () => {
  const result = ingestEmlDirectory(FIXTURE_DIR);
  assert.equal(result.ok, true);
  assert.ok(result.matchedMessages >= 1);
  assert.ok(result.accepted >= 1);
  assert.ok(result.packets.every((p) => p.publicationStatus === 'evidence_only'));
});

test('ingestImapMailbox fails closed when credentials are missing', async () => {
  const result = await ingestImapMailbox({});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'imap_not_configured');
  assert.equal(result.accepted, 0);
});

test('isConfigured is false without IMAP env', () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({
    IMAP_HOST: 'imap.example.com',
    IMAP_USER: 'alerts@example.com',
    IMAP_PASS: 'secret',
  }), true);
});

test('PublicNoticesEmailScraper reports observation error when unconfigured', async () => {
  const scraper = new PublicNoticesEmailScraper({ env: {} });
  const result = await scraper.scrapeFeed();
  assert.equal(result.accepted, 0);
  assert.equal(result.error, 'imap_not_configured');
  assert.equal(result.report.complete, false);
  assert.equal(result.publicationStatus, undefined);
});

test('PublicNoticesEmailScraper ingests corpus without IMAP credentials', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'email-notices-'));
  const scraper = new PublicNoticesEmailScraper({
    env: { PROPERTY_EMAIL_NOTICE_PATH: path.join(tmp, 'store.json') },
    corpusDir: FIXTURE_DIR,
  });
  const result = await scraper.scrapeFeed();
  assert.ok(result.accepted >= 1);
  assert.equal(result.publicationStatus, 'evidence_only');
  assert.ok(fs.existsSync(path.join(tmp, 'store.json')));
});

test('writePackets is idempotent for the same notice hash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'email-notices-'));
  const storePath = path.join(tmp, 'store.json');
  const packets = messageToPackets({
    subject: "Trustee's Sale",
    body: 'Opening bid: $12,000 2 Elm St, Toledo, OH 43601',
    messageId: '<idem@example>',
  }, { keywords: DEFAULT_KEYWORDS }).packets;
  const first = writePackets(packets, storePath);
  const second = writePackets(packets, storePath);
  assert.equal(first.appended, packets.length);
  assert.equal(second.appended, 0);
});
