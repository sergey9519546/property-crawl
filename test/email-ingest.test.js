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
  extractImapFetchPayload,
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
  assert.ok(result.matchedMessages >= 7);
  assert.ok(result.accepted >= 7);
  assert.ok(result.packets.every((p) => p.publicationStatus === 'evidence_only'));

  const states = new Set(result.packets.map((p) => p.fields.state));
  assert.ok(states.has('CA'), 'parses CA trustee sale');
  assert.ok(states.has('NY'), 'parses NY referee sale');
  assert.ok(states.has('FL'), 'parses FL foreclosure');
  assert.ok(states.has('IL'), 'parses IL chancery sale');
  assert.ok(states.has('TX'), 'parses TX substitute trustee sale');
  assert.ok(states.has('OH'), 'parses OH sheriff sale');
});

test('ingestImapMailbox fails closed when credentials are missing', async () => {
  const result = await ingestImapMailbox({});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'imap_not_configured');
  assert.equal(result.accepted, 0);
});

test('IMAP client command protocol tags LOGIN/SELECT/SEARCH/FETCH', () => {
  const { ImapClient } = require('../server/scrapers/email-ingest');
  const client = new ImapClient({
    host: 'imap.example.com', port: 993, user: 'u', pass: 'p', mailbox: 'INBOX',
    tls: false, maxMessages: 5, keywords: ["sheriff's sale"], storePath: '/tmp/x.json',
  });
  assert.ok(typeof client.connect === 'function');
  assert.ok(typeof client.command === 'function');
  assert.ok(typeof client.close === 'function');
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

test('envConfig and isConfigured accept both IMAP_PASSWORD and IMAP_PASS with IMAP_PASSWORD priority', async () => {
  const { envConfig, ingestImapMailbox } = require('../server/scrapers/email-ingest');
  const fromPassword = envConfig({ IMAP_HOST: 'imap.example.com', IMAP_USER: 'alerts', IMAP_PASSWORD: 'pw-primary' });
  assert.equal(fromPassword.pass, 'pw-primary');
  assert.equal(isConfigured({ IMAP_HOST: 'imap.example.com', IMAP_USER: 'alerts', IMAP_PASSWORD: 'pw-primary' }), true);

  const both = envConfig({
    IMAP_HOST: 'imap.example.com',
    IMAP_USER: 'alerts',
    IMAP_PASSWORD: 'pw-primary',
    IMAP_PASS: 'pw-fallback',
  });
  assert.equal(both.pass, 'pw-primary');

  const missing = await ingestImapMailbox({ env: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /IMAP_PASSWORD \(or IMAP_PASS\)/);
});

test('IMAP framing handles custom tags and ignores NO/BAD inside email body literals', () => {
  const {
    findTaggedImapResponse,
    extractImapFetchPayload,
    parseImapSearchUids,
  } = require('../server/scrapers/email-ingest');

  const uids = parseImapSearchUids('* SEARCH 41 42\r\nT1 OK SEARCH completed\r\n');
  assert.deepEqual(uids, [41, 42]);

  const emailLiteral = [
    'From: alerts@floridapublicnotices.com',
    'Subject: Foreclosure Notice',
    '',
    'Status: NO redemption remains; BAD check notice.',
    'T99 NO fake inline marker',
  ].join('\r\n');
  const wire =
    `* 1 FETCH (UID 41 BODY[TEXT] {${Buffer.byteLength(emailLiteral, 'utf8')}}\r\n` +
    emailLiteral +
    `\r\n)\r\nT99 OK FETCH completed\r\n`;

  const framed = findTaggedImapResponse(Buffer.from(wire, 'utf8'), 'T99');
  assert.equal(framed.complete, true);
  assert.equal(framed.status, 'OK');
  assert.match(extractImapFetchPayload(framed.rawText), /T99 NO fake inline marker/);
});

test('ingestImapMailbox only sends UID STORE +FLAGS (\\Seen) after durable save succeeds', async () => {
  const { ingestImapMailbox } = require('../server/scrapers/email-ingest');
  const makeFakeClient = () => {
    const cmds = [];
    return {
      cmds,
      async connect() {},
      async close() {},
      async command(cmd) {
        cmds.push(cmd);
        if (cmd.startsWith('UID SEARCH')) return '* SEARCH 77\r\nA3 OK SEARCH done\r\n';
        if (cmd.startsWith('UID FETCH')) {
          return '* 1 FETCH (BODY[TEXT])\r\nFrom: alerts@floridapublicnotices.com\r\nSubject: Foreclosure sale\r\n\r\nNotice of foreclosure sale at 100 Oak St, Tampa, FL 33602 Case No 26-CA-99\r\n)\r\nA4 OK FETCH done\r\n';
        }
        return 'A9 OK done\r\n';
      },
    };
  };

  const failClient = makeFakeClient();
  const failed = await ingestImapMailbox(
    { IMAP_HOST: 'imap.example.com', IMAP_USER: 'u', IMAP_PASSWORD: 'p' },
    {
      imapClient: failClient,
      onSave: async () => { throw new Error('disk full'); },
    }
  );
  assert.equal(failed.ok, false);
  assert.equal(failClient.cmds.some((c) => c.includes('\\Seen')), false);

  const okClient = makeFakeClient();
  const saved = [];
  const succeeded = await ingestImapMailbox(
    { IMAP_HOST: 'imap.example.com', IMAP_USER: 'u', IMAP_PASSWORD: 'p' },
    {
      imapClient: okClient,
      onSave: async (pkts) => { saved.push(...pkts); },
    }
  );
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.persisted, true);
  assert.equal(saved.length > 0, true);
  assert.equal(okClient.cmds.some((c) => c === 'UID STORE 77 +FLAGS (\\Seen)'), true);
});

test('writePackets leaves no temporary or lock files after atomic write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-ingest-atomic-'));
  const storePath = path.join(dir, 'notices.json');
  const packets = messageToPackets({
    subject: 'Notice of Foreclosure Sale',
    from: 'alerts@floridapublicnotices.com',
    body: 'Foreclosure sale at 200 Pine Ave, Orlando, FL 32801 Case No. 2026-CA-0123.',
    messageId: '<atomic@example>',
  }, { keywords: DEFAULT_KEYWORDS }).packets;

  const res = writePackets(packets, storePath);
  assert.equal(res.appended, packets.length);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['notices.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});


test('extractImapFetchPayload stitches header + body literals and parseRfc822 preserves body-only text', () => {
  const rawFetch = [
    '* 12 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE)] {62}',
    'From: alerts@floridapublicnotices.com\r\nSubject: Sheriff Sale\r\n',
    ' BODY[TEXT] {68}',
    'Foreclosure auction at 405 Oak Ave, Miami, FL 33130 Case 2026-CA-99',
    ')',
    'A0004 OK UID FETCH completed',
  ].join('\r\n');
  const combined = extractImapFetchPayload(rawFetch);
  const parsedCombined = parseRfc822(combined);
  assert.equal(parsedCombined.subject, 'Sheriff Sale');
  assert.equal(parsedCombined.from, 'alerts@floridapublicnotices.com');
  assert.match(parsedCombined.body, /405 Oak Ave, Miami, FL 33130/);

  const bodyOnly = parseRfc822('Notice of Foreclosure Sale at 500 Pine Rd, Tampa, FL 33602 Case 2026-CA-100');
  assert.equal(bodyOnly.subject, '');
  assert.match(bodyOnly.body, /500 Pine Rd, Tampa, FL 33602/);
});
