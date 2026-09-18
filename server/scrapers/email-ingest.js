'use strict';
/**
 * server/scrapers/email-ingest.js — Press-association email-as-API ingestion
 * (docs/STRATEGY.md Hack #1).
 *
 * Ingests statutory public-notice alert emails from a dedicated mailbox or
 * local .eml corpus. Notices are treated as untrusted evidence: parsed with
 * the deterministic notice parser, never auto-published as actionable
 * listings, and never scraped from publisher websites that ban bots.
 *
 * Fail-closed when IMAP credentials are absent. No challenge bypass.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const {
  parseLegalNotice,
  neutralizePromptInjection,
  normalizeOcrText,
} = require('../ai/notice-parser');

const SOURCE_KEY = 'public-notices-email';
const SOURCE_ID = 'press-association-email';

const DEFAULT_KEYWORDS = [
  "sheriff's sale",
  'sheriff sale',
  'notice of foreclosure sale',
  "trustee's sale",
  'trustee sale',
  'foreclosure sale',
  'tax sale',
  'mortgage foreclosure',
  'notice of default',
  'lis pendens',
];

const DEFAULT_STORE_PATH = path.resolve(process.cwd(), '.cache', 'email-notices.json');

function cleanHeader(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function envConfig(env = process.env) {
  return {
    host: env.IMAP_HOST || '',
    port: Number(env.IMAP_PORT || 993),
    user: env.IMAP_USER || '',
    pass: env.IMAP_PASS || '',
    tls: String(env.IMAP_TLS || 'true').toLowerCase() !== 'false',
    mailbox: env.IMAP_MAILBOX || 'INBOX',
    maxMessages: Math.max(1, Math.min(Number(env.IMAP_MAX_MESSAGES || 50), 500)),
    keywords: (env.IMAP_KEYWORDS || DEFAULT_KEYWORDS.join('|'))
      .split('|')
      .map((k) => k.trim())
      .filter(Boolean),
    storePath: env.PROPERTY_EMAIL_NOTICE_PATH || DEFAULT_STORE_PATH,
  };
}

function isConfigured(env = process.env) {
  const cfg = envConfig(env);
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

/**
 * Parse a raw RFC822 message (or body-only fixture) into headers + text body.
 * @param {string} raw
 */
function parseRfc822(raw) {
  const text = String(raw || '');
  const split = text.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
  const idx = text.indexOf(split);
  const headerBlock = idx >= 0 ? text.slice(0, idx) : text;
  const body = idx >= 0 ? text.slice(idx + split.length) : '';
  const headers = {};
  const lines = headerBlock.split(/\r?\n/);
  let lastKey = null;
  for (const line of lines) {
    const cont = line.match(/^[ \t]+(.*)$/);
    if (cont && lastKey) {
      headers[lastKey] = `${headers[lastKey]} ${cleanHeader(cont[1])}`;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m) continue;
    lastKey = m[1].toLowerCase();
    headers[lastKey] = cleanHeader(m[2]);
  }

  let bodyText = body;
  const ct = headers['content-type'] || '';
  if (/multipart\//i.test(ct)) {
    // Prefer the first text/plain part; keep raw body if none found.
    const parts = body.split(/--[^\r\n]+/g)
      .map((p) => p.replace(/^\s*Content-Type:[^\n]*\n/gi, '').replace(/^\s*Content-Transfer-Encoding:[^\n]*\n/gi, '').replace(/^\s*Content-Disposition:[^\n]*\n/gi, '').trim())
      .filter((p) => p && !/^--/.test(p) && !/^Content-Type:/i.test(p));
    const plain = parts.find((p) => !/html/i.test(p) && p.length > 20);
    if (plain) bodyText = plain;
  }
  bodyText = bodyText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return {
    headers,
    subject: headers.subject || '',
    from: headers.from || '',
    date: headers.date || '',
    messageId: headers['message-id'] || '',
    body: bodyText,
  };
}

function matchesKeywords(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.some((k) => lower.includes(String(k).toLowerCase()));
}

/**
 * Convert one parsed email into evidence packets (not live listings).
 */
function messageToPackets(message, { keywords = DEFAULT_KEYWORDS, observedAt = new Date().toISOString() } = {}) {
  const subject = message.subject || '';
  const body = message.body || '';
  const combined = `${subject}\n${body}`;
  if (!matchesKeywords(combined, keywords)) {
    return { matched: false, packets: [] };
  }

  const cleaned = neutralizePromptInjection(normalizeOcrText(body || subject));
  const parsedParcels = parseLegalNotice(cleaned);
  const packets = parsedParcels.map((fields, index) => {
    const noticeText = cleaned;
    return {
      sourceKey: SOURCE_KEY,
      sourceId: SOURCE_ID,
      role: 'discovery',
      observedAt,
      messageId: message.messageId || sha256(combined),
      subject,
      from: message.from,
      date: message.date,
      parcelIndex: index,
      noticeExcerpt: noticeText.slice(0, 2000),
      noticeSha256: sha256(noticeText),
      fields,
      strategy: fields._strategy || 'deterministic_fallback',
      publicationStatus: 'evidence_only',
      notes: 'Statutory email alert is evidence; resolve to the publisher sale record before listing publication.',
    };
  });

  return { matched: true, packets };
}

/**
 * Load .eml / .txt fixtures from a directory (offline corpus / tests).
 */
function ingestEmlDirectory(dir, options = {}) {
  const keywords = options.keywords || DEFAULT_KEYWORDS;
  const observedAt = options.observedAt || new Date().toISOString();
  if (!dir || !fs.existsSync(dir)) {
    return {
      ok: false,
      error: 'email_corpus_missing',
      accepted: 0,
      packets: [],
    };
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(eml|txt)$/i.test(f));
  const packets = [];
  let matched = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const message = parseRfc822(raw);
    if (!message.subject && !message.body) continue;
    const result = messageToPackets(message, { keywords, observedAt });
    if (result.matched) {
      matched += 1;
      packets.push(...result.packets);
    }
  }
  return {
    ok: true,
    mode: 'corpus',
    filesScanned: files.length,
    matchedMessages: matched,
    accepted: packets.length,
    packets,
  };
}

function writePackets(packets, storePath = DEFAULT_STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  let existing = [];
  if (fs.existsSync(storePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {
      existing = [];
    }
  }
  const seen = new Set(existing.map((p) => `${p.messageId || ''}:${p.parcelIndex || 0}:${p.noticeSha256 || ''}`));
  const appended = [];
  for (const packet of packets) {
    const key = `${packet.messageId || ''}:${packet.parcelIndex || 0}:${packet.noticeSha256 || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    appended.push(packet);
  }
  const next = existing.concat(appended);
  const tmp = `${storePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, storePath);
  return { storePath, total: next.length, appended: appended.length };
}

/**
 * Minimal IMAP client (LOGIN/SELECT/SEARCH/FETCH/STORE/LOGOUT).
 * Used only against an operator-configured mailbox that the operator is
 * authorized to read (their own alert subscription inbox).
 */
class ImapClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.socket = null;
    this.buffer = '';
    this.tagSeq = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const onReady = () => {
        this.socket.removeListener('error', onError);
        resolve();
      };
      if (this.cfg.tls) {
        this.socket = tls.connect({
          host: this.cfg.host,
          port: this.cfg.port,
          servername: this.cfg.host,
          rejectUnauthorized: true,
        }, onReady);
      } else {
        this.socket = net.connect({ host: this.cfg.host, port: this.cfg.port }, onReady);
      }
      this.socket.once('error', onError);
      this.socket.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
      });
    });
  }

  _waitLine(prefix) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        if (this.buffer.includes(prefix)) {
          resolve(this.buffer);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`IMAP timeout waiting for ${prefix}`));
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async command(cmd, waitPrefix) {
    this.tagSeq += 1;
    const tag = `A${this.tagSeq}`;
    const full = `${tag} ${cmd}\r\n`;
    this.buffer = '';
    this.socket.write(full);
    const out = await this._waitLine(waitPrefix || `${tag} `);
    if (!/OK/i.test(out.split('\r\n').pop() || out)) {
      const failed = /NO|BAD/i.test(out);
      if (failed && waitPrefix !== `${tag} `) {
        throw new Error(`IMAP command failed: ${cmd}`);
      }
    }
    return out;
  }

  close() {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve();
        return;
      }
      try {
        this.socket.write('A99 LOGOUT\r\n');
      } catch (_) {}
      this.socket.end();
      setTimeout(() => resolve(), 50);
    });
  }
}

/**
 * Fetch unseen messages from the configured IMAP mailbox and parse them.
 * Fails closed when credentials are missing.
 */
async function ingestImapMailbox(env = process.env, options = {}) {
  const cfg = options.cfg || envConfig(env);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return {
      ok: false,
      error: 'imap_not_configured',
      reason: 'IMAP_HOST, IMAP_USER, and IMAP_PASS are required',
      accepted: 0,
      packets: [],
    };
  }

  const client = new ImapClient(cfg);
  const observedAt = options.observedAt || new Date().toISOString();
  try {
    await client.connect();
    await client.command(`LOGIN ${cfg.user} ${JSON.stringify(cfg.pass)}`);
    await client.command(`SELECT ${cfg.mailbox}`);
    const searchOut = await client.command('UID SEARCH UNSEEN', 'A');
    const uidLine = (searchOut.split(/\r?\n/).find((l) => /SEARCH/i.test(l)) || '').trim();
    const uids = (uidLine.match(/\d+/g) || [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, cfg.maxMessages);

    const packets = [];
    let matchedMessages = 0;
    for (const uid of uids) {
      let fetchOut;
      try {
        fetchOut = await client.command(`UID FETCH ${uid} BODY[TEXT]`);
      } catch (_) {
        continue;
      }
      const bodyStart = fetchOut.indexOf('{');
      let body = fetchOut;
      if (bodyStart >= 0) {
        const rest = fetchOut.slice(fetchOut.indexOf('}', bodyStart) + 1);
        body = rest.replace(/\)\s*A\d+\s+OK[^\r\n]*/i, '').trim();
      }
      const message = parseRfc822(body);
      if (!message.subject && !message.body) {
        // Subject may not be in BODY[TEXT]; still parse body-only.
        if (!body || body.length < 20) continue;
      }
      const result = messageToPackets(
        {
          ...message,
          messageId: message.messageId || `imap-${uid}`,
        },
        { keywords: cfg.keywords, observedAt }
      );
      if (result.matched) {
        matchedMessages += 1;
        packets.push(...result.packets);
        try {
          await client.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
        } catch (_) {}
      }
    }

    return {
      ok: true,
      mode: 'imap',
      mailbox: cfg.mailbox,
      uidsSearched: uids.length,
      matchedMessages,
      accepted: packets.length,
      packets,
    };
  } catch (err) {
    return {
      ok: false,
      error: 'imap_ingest_failed',
      reason: err.message,
      accepted: 0,
      packets: [],
    };
  } finally {
    await client.close();
  }
}

/**
 * Scheduler-facing collector surface.
 */
class PublicNoticesEmailScraper {
  constructor(options = {}) {
    this.name = 'PublicNoticesEmail';
    this.sourceKey = SOURCE_KEY;
    this.sourceId = SOURCE_ID;
    this.env = options.env || process.env;
    this.corpusDir = options.corpusDir || options.env?.IMAP_CORPUS_DIR || process.env.IMAP_CORPUS_DIR || '';
  }

  getCollectionScope() {
    return {
      endpoint: 'imap://mailbox-alerts',
      filters: {
        mailbox: envConfig(this.env).mailbox,
        keywords: envConfig(this.env).keywords,
      },
    };
  }

  async scrapeFeed() {
    const reports = [];
    let packets = [];

    if (this.corpusDir) {
      const corpus = ingestEmlDirectory(this.corpusDir, {
        keywords: envConfig(this.env).keywords,
      });
      reports.push(corpus);
      if (corpus.ok) packets = packets.concat(corpus.packets);
    }

    if (isConfigured(this.env)) {
      const imap = await ingestImapMailbox(this.env);
      reports.push(imap);
      if (imap.ok) packets = packets.concat(imap.packets);
    } else if (!this.corpusDir) {
      return {
        source: this.sourceKey,
        accepted: 0,
        rejected: 0,
        error: 'imap_not_configured',
        observationError: true,
        report: {
          complete: false,
          fullSweepComplete: false,
          truncated: false,
          reason: 'Email alerts require IMAP credentials or an IMAP_CORPUS_DIR fixture path',
        },
      };
    }

    if (packets.length > 0) {
      try {
        writePackets(packets, envConfig(this.env).storePath);
      } catch (err) {
        reports.push({ ok: false, error: 'store_write_failed', reason: err.message });
      }
    }

    const complete = reports.every((r) => r.ok) && (packets.length > 0 || reports.some((r) => r.mode === 'imap'));
    return {
      source: this.sourceKey,
      accepted: packets.length,
      rejected: 0,
      evidencePackets: packets.length,
      publicationStatus: 'evidence_only',
      report: {
        complete,
        fullSweepComplete: complete,
        truncated: false,
        mode: packets.length > 0 ? 'email_alerts' : 'configured_empty',
        details: reports,
      },
    };
  }
}

module.exports = {
  SOURCE_KEY,
  SOURCE_ID,
  DEFAULT_KEYWORDS,
  DEFAULT_STORE_PATH,
  envConfig,
  isConfigured,
  parseRfc822,
  messageToPackets,
  ingestEmlDirectory,
  ingestImapMailbox,
  writePackets,
  PublicNoticesEmailScraper,
  ImapClient,
};
