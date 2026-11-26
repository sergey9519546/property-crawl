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
  acquireOwnedLock,
  releaseOwnedLock,
  replaceFileWithRetry,
} = require('../intelligence/research-store');
const {
  parseLegalNotice,
  neutralizePromptInjection,
  normalizeOcrText,
} = require('../ai/notice-parser');
const { parseLaDocumentIntake } = require('./adapters/la-recorder');

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
  'tax deed sale',
  'master commissioner sale',
  'judicial sale',
  'notice of sale',
  'reo property',
  'treasury seizure'
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
    pass: env.IMAP_PASSWORD || env.IMAP_PASS || '',
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
function decodeTransferEncoding(rawBody, encoding) {
  const text = String(rawBody || '');
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') {
    try {
      return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch (_) {
      return text;
    }
  }
  if (enc === 'quoted-printable') {
    const unfolded = text.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < unfolded.length; i++) {
      if (unfolded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
        bytes.push(Number.parseInt(unfolded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        const chBuf = Buffer.from(unfolded[i], 'utf8');
        for (const b of chBuf) bytes.push(b);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return text;
}

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
  if (Object.keys(headers).length === 0) {
    bodyText = text;
  }
  const ct = headers['content-type'] || '';
  if (/multipart\//i.test(ct)) {
    // Prefer the first text/plain part; decode MIME Content-Transfer-Encoding cleanly.
    const parts = body.split(/--[^\r\n]+/g)
      .map((partRaw) => {
        const encMatch = partRaw.match(/^\s*Content-Transfer-Encoding:\s*([^\r\n]+)/im);
        const stripped = partRaw
          .replace(/^\s*Content-Type:[^\n]*\n/gi, '')
          .replace(/^\s*Content-Transfer-Encoding:[^\n]*\n/gi, '')
          .replace(/^\s*Content-Disposition:[^\n]*\n/gi, '')
          .trim();
        return decodeTransferEncoding(stripped, encMatch?.[1]);
      })
      .filter((p) => p && !/^--/.test(p) && !/^Content-Type:/i.test(p));
    const plain = parts.find((p) => !/html/i.test(p) && p.length > 20);
    if (plain) bodyText = plain;
  } else if (headers['content-transfer-encoding']) {
    bodyText = decodeTransferEncoding(bodyText, headers['content-transfer-encoding']);
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
  const looksLikeLaNotice = /\b(?:los\s+angeles|la\s+county|lavote\.gov)\b/i.test(cleaned) || /\b\d{4}-\d{3}-\d{3}\b/.test(cleaned);
  const laRecords = looksLikeLaNotice ? parseLaDocumentIntake(cleaned) : [];
  const packets = parsedParcels.map((rawFields, index) => {
    const laMatch = laRecords[index] || laRecords[0] || null;
    const fields = laMatch
      ? {
          ...rawFields,
          apn: rawFields.apn || laMatch.ain || null,
          caseNumber: rawFields.caseNumber || laMatch.caseNumber || null,
          county: rawFields.county || (laMatch.county ? 'Los Angeles' : null),
          state: rawFields.state || laMatch.state || null,
          distressStage: rawFields.distressStage || laMatch.distressStage || null,
          grantor: rawFields.grantor || laMatch.grantor || null,
          grantee: rawFields.grantee || laMatch.grantee || null,
        }
      : rawFields;
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

function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* sync wait fallback */ }
  }
}

function acquireLockWithRetry(lockPath, attempts = 25) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return acquireOwnedLock(lockPath, { staleLockMs: 30_000 });
    } catch (err) {
      if (err && err.code === 'EEXIST' && i < attempts - 1) {
        sleepSync(5 + Math.min(i * 2, 15));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Timed out acquiring email packet store lock: ${lockPath}`);
}

function writePackets(packets, storePath = DEFAULT_STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const lockPath = `${storePath}.lock`;
  const lockHandle = acquireLockWithRetry(lockPath);
  const tmp = `${storePath}.${crypto.randomUUID()}.tmp`;
  try {
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
    for (const packet of (packets || [])) {
      const key = `${packet.messageId || ''}:${packet.parcelIndex || 0}:${packet.noticeSha256 || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      appended.push(packet);
    }
    const next = existing.concat(appended);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    replaceFileWithRetry(tmp, storePath);
    return { storePath, total: next.length, appended: appended.length };
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    releaseOwnedLock(lockHandle);
  }
}

/**
 * Minimal IMAP client (LOGIN/SELECT/SEARCH/FETCH/STORE/LOGOUT).
 * Used only against an operator-configured mailbox that the operator is
 * authorized to read (their own alert subscription inbox).
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inspect a raw IMAP byte buffer for a CRLF-terminated `${tag} (OK|NO|BAD)` line
 * outside any `{N}` RFC-3501 literal payloads.
 */
function findTaggedImapResponse(rawBuffer, tag) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(String(rawBuffer || ''), 'utf8');
  const tagRe = new RegExp(`^${escapeRegex(tag)}\\s+(OK|NO|BAD)(?:\\s+(.*))?$`, 'i');
  let pos = 0;
  while (pos < buf.length) {
    const crlf = buf.indexOf('\r\n', pos, 'utf8');
    if (crlf === -1) {
      return { complete: false };
    }
    const line = buf.subarray(pos, crlf).toString('utf8');
    const litMatch = line.match(/\{(\d+)\+?\}$/);
    if (litMatch) {
      const litLen = Number(litMatch[1]);
      const litStart = crlf + 2;
      if (litStart + litLen > buf.length) {
        return { complete: false };
      }
      pos = litStart + litLen;
      continue;
    }
    const m = line.match(tagRe);
    if (m) {
      return {
        complete: true,
        status: m[1].toUpperCase(),
        detail: (m[2] || '').trim(),
        rawText: buf.subarray(0, crlf + 2).toString('utf8'),
        endOffset: crlf + 2,
      };
    }
    pos = crlf + 2;
  }
  return { complete: false };
}

function parseImapSearchUids(searchOut, limit = Infinity) {
  const lines = String(searchOut || '').split(/\r?\n/);
  const uids = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!/^\*\s+SEARCH\b/i.test(trimmed)) continue;
    const afterKeyword = trimmed.replace(/^\*\s+SEARCH\b/i, '');
    for (const token of (afterKeyword.match(/\d+/g) || [])) {
      const n = Number(token);
      if (Number.isFinite(n) && n > 0) uids.push(n);
    }
  }
  return Number.isFinite(limit) ? uids.slice(0, limit) : uids;
}

function extractImapFetchPayload(rawText) {
  const buf = Buffer.from(String(rawText || ''), 'utf8');
  const literals = [];
  let pos = 0;
  while (pos < buf.length) {
    const crlf = buf.indexOf('\r\n', pos, 'utf8');
    if (crlf === -1) break;
    const line = buf.subarray(pos, crlf).toString('utf8');
    const litMatch = line.match(/\{(\d+)\+?\}$/);
    if (litMatch) {
      const litLen = Number(litMatch[1]);
      const litStart = crlf + 2;
      const litEnd = Math.min(buf.length, litStart + litLen);
      literals.push(buf.subarray(litStart, litEnd).toString('utf8'));
      pos = litEnd;
      continue;
    }
    pos = crlf + 2;
  }
  if (literals.length === 1) return literals[0].trim();
  if (literals.length > 1) {
    let combined = '';
    for (const part of literals) {
      if (!combined) {
        combined = part;
      } else if (/\r?\n\r?\n$/.test(combined)) {
        combined += part;
      } else {
        combined += '\r\n\r\n' + part;
      }
    }
    return combined.trim();
  }
  // Fallback for mock servers returning plain RFC822 lines without {N} literals.
  return String(rawText || '')
    .replace(/^\*\s+\d+\s+FETCH\s*\([^\r\n]*\r?\n?/i, '')
    .replace(/(?:\r?\n)?\)?\s*(?:\r?\n)?A\d+\s+(?:OK|NO|BAD)[^\r\n]*(?:\r?\n)?$/i, '')
    .trim();
}

class ImapClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.socket = null;
    this.buffer = '';
    this._rawBuffer = Buffer.alloc(0);
    this.tagSeq = 0;
    this.lastSocketError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const onReady = () => {
        this.socket.removeListener('error', onError);
        this.socket.on('error', (err) => {
          this.lastSocketError = err;
        });
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
        const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
        this._rawBuffer = Buffer.concat([this._rawBuffer, chunkBuf]);
        this.buffer = this._rawBuffer.toString('utf8');
      });
    });
  }

  _waitTaggedResponse(tag) {
    const timeoutMs = Number(this.cfg?.timeoutMs) > 0 ? Number(this.cfg.timeoutMs) : 30000;
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        if (this.lastSocketError) {
          reject(this.lastSocketError);
          return;
        }
        const parsed = findTaggedImapResponse(this._rawBuffer, tag);
        if (parsed.complete) {
          this._rawBuffer = this._rawBuffer.subarray(parsed.endOffset);
          this.buffer = this._rawBuffer.toString('utf8');
          resolve(parsed);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`IMAP timeout waiting for ${tag} completion`));
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async command(cmd) {
    this.tagSeq += 1;
    const tag = `A${this.tagSeq}`;
    const full = `${tag} ${cmd}\r\n`;
    this.socket.write(full);
    const res = await this._waitTaggedResponse(tag);
    if (res.status === 'NO' || res.status === 'BAD') {
      throw new Error(`IMAP command failed (${tag} ${res.status}): ${res.detail || cmd}`);
    }
    return res.rawText;
  }

  close() {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve();
        return;
      }
      this.tagSeq += 1;
      const tag = `A${this.tagSeq}`;
      try {
        this.socket.write(`${tag} LOGOUT\r\n`);
      } catch (_) {}
      try { this.socket.end(); } catch (_) {}
      setTimeout(() => {
        try { if (!this.socket.destroyed) this.socket.destroy(); } catch (_) {}
        resolve();
      }, 50);
    });
  }
}

/**
 * Fetch unseen messages from the configured IMAP mailbox and parse them.
 * Fails closed when credentials are missing.
 */
async function ingestImapMailbox(env = process.env, options = {}) {
  if (
    env &&
    typeof env === 'object' &&
    env.env &&
    typeof env.env === 'object' &&
    !('IMAP_HOST' in env) &&
    !('IMAP_USER' in env) &&
    !('IMAP_PASSWORD' in env) &&
    !('IMAP_PASS' in env)
  ) {
    if (!options || Object.keys(options).length === 0) {
      options = env;
    }
    env = env.env;
  }
  const cfg = options.cfg || envConfig(env);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return {
      ok: false,
      error: 'imap_not_configured',
      reason: 'IMAP_HOST, IMAP_USER, and IMAP_PASSWORD (or IMAP_PASS) are required',
      accepted: 0,
      packets: [],
    };
  }

  const client = options.imapClient || new ImapClient(cfg);
  const observedAt = options.observedAt || new Date().toISOString();
  try {
    await client.connect();
    await client.command(`LOGIN ${cfg.user} ${JSON.stringify(cfg.pass)}`);
    await client.command(`SELECT ${cfg.mailbox}`);
    const searchOut = await client.command('UID SEARCH UNSEEN');
    const uids = parseImapSearchUids(searchOut, cfg.maxMessages);

    const packets = [];
    const matchedUids = [];
    let matchedMessages = 0;
    for (const uid of uids) {
      let fetchOut;
      try {
        fetchOut = await client.command(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE)] BODY.PEEK[TEXT])`);
      } catch (_) {
        continue;
      }
      const body = extractImapFetchPayload(fetchOut);
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
        matchedUids.push(uid);
        packets.push(...result.packets);
      }
    }

    let persisted = false;
    if (packets.length > 0 && options.persist !== false) {
      if (typeof options.onSave === 'function') {
        await options.onSave(packets);
      } else {
        writePackets(packets, options.storePath || cfg.storePath);
      }
      persisted = true;
    }

    // Only acknowledge \Seen on the mailbox AFTER parsing and durable save succeed.
    if (matchedUids.length > 0 && (packets.length === 0 || persisted)) {
      for (const uid of matchedUids) {
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
      persisted,
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
    this.db = options.db || null;
    this.usePipeline = options.usePipeline !== false;
    this.circuitBreaker = null;
    this.lastRunReport = null;
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

  /**
   * This collector emits no listing rows. scrapeFeed() parses messages into
   * evidence packets, writes them to a store and reports counts with
   * `publicationStatus: 'evidence_only'` - there is never a listing for the
   * scheduler to key a publisher record against, so this is never called with
   * anything meaningful.
   *
   * Declaring it explicitly is what the adapter contract requires, and null is
   * the honest value: the publisher payload is absent, not derived. Returning a
   * constructed object here would put a shape into raw_payload that no publisher
   * ever sent.
   */
  getRawPublisherRecord() {
    return null;
  }

  async scrapeFeed() {
    const reports = [];
    let packets = [];

    let corpusPackets = [];
    if (this.corpusDir) {
      const corpus = ingestEmlDirectory(this.corpusDir, {
        keywords: envConfig(this.env).keywords,
      });
      reports.push(corpus);
      if (corpus.ok) {
        corpusPackets = corpus.packets;
        packets = packets.concat(corpusPackets);
      }
    }

    if (corpusPackets.length > 0) {
      try {
        writePackets(corpusPackets, envConfig(this.env).storePath);
      } catch (err) {
        reports.push({ ok: false, error: 'store_write_failed', reason: err.message });
      }
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

    let pipelineReport = null;
    if (this.usePipeline) {
      try {
        const { EmailNoticesPipeline } = require('../sources/email-notices');
        const pipeline = new EmailNoticesPipeline({
          env: this.env,
          corpusDir: this.corpusDir || undefined,
          ...(this.db ? { db: this.db } : {}),
        });
        if (pipeline.isConfigured()) {
          pipelineReport = await pipeline.ingest();
          reports.push({ ok: Boolean(pipelineReport?.ok), mode: 'pipeline', ...pipelineReport });
        }
      } catch (err) {
        reports.push({ ok: false, mode: 'pipeline', error: err.message });
      }
    }

    const complete = reports.every((r) => r.ok) && (packets.length > 0 || reports.some((r) => r.mode === 'imap' || r.mode === 'pipeline'));
    return {
      source: this.sourceKey,
      accepted: packets.length || Number(pipelineReport?.listingsAccepted || 0),
      rejected: Number(pipelineReport?.listingsRejected || 0),
      evidencePackets: packets.length,
      listingsAccepted: Number(pipelineReport?.listingsAccepted || 0),
      reviewsRouted: Number(pipelineReport?.reviewsRouted || 0),
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
  findTaggedImapResponse,
  parseImapSearchUids,
  extractImapFetchPayload,
};
