'use strict';

/**
 * server/sources/email-notices.js
 *
 * Automated Statewide Email-as-API Ingestion Pipeline (docs/STRATEGY.md Hack #1).
 * Ingests free statutory email alerts from press-association notification feeds
 * without scraping anti-bot publisher portals.
 *
 * Implements clean IMAP alert intake protocol:
 * - Queries for unread legal notices from press association domains
 * - Supports dependency-injected IMAP client or mock transport for unit testing.
 * - Parses legal notice bodies using server/ai/notice-parser.js (parseLegalNotice / deterministicParse).
 * - Standardizes output into canonical listing objects with full provenance
 *   (publisher, recordId, observedAt, origin: 'email_notice').
 * - Upserts accepted listings through the standard ingestion flow.
 * - Fails closed with typed error IMAP_CREDENTIALS_UNSET when credentials are not configured.
 */

const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const emailFeeds = require('./email-feeds.json');
const {
  normalizeOcrText,
  neutralizePromptInjection,
  splitMultiParcelNotice,
  deterministicParse,
  parseLegalNotice,
} = require('../ai/notice-parser');
const { detectNoticeState } = require('./email-notice-collector');
const { validateListingForIngestion } = require('../scrapers/validation');
const defaultDb = require('../db/client');

const FEED_CONFIG = emailFeeds.feeds || {};

const PRESS_ASSOCIATION_DOMAINS = Object.freeze([
  ...new Set(
    Object.values(FEED_CONFIG).flatMap((feed) =>
      (feed.senderDomains || []).map((d) => d.split('/')[0].trim().toLowerCase())
    )
  ),
]);

class ImapCredentialsUnsetError extends Error {
  constructor(message = 'IMAP credentials unset: IMAP_HOST, IMAP_USER, and IMAP_PASSWORD are required') {
    super(message);
    this.name = 'ImapCredentialsUnsetError';
    this.code = 'IMAP_CREDENTIALS_UNSET';
  }
}

function hashNotice(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function isFromPressAssociation(from = '', allowedDomains = PRESS_ASSOCIATION_DOMAINS) {
  const lower = String(from || '').toLowerCase();
  return allowedDomains.some((d) => lower.includes(d.toLowerCase()));
}

/**
 * Default minimal IMAP client for live alert mailbox intake.
 */
class DefaultImapClient {
  constructor(cfg = {}) {
    this.cfg = {
      host: cfg.host || '',
      port: Number(cfg.port || (cfg.tls === false ? 143 : 993)),
      user: cfg.user || '',
      pass: cfg.pass || cfg.password || '',
      tls: cfg.tls !== false,
      mailbox: cfg.mailbox || 'INBOX',
      timeoutMs: Number(cfg.timeoutMs || 30000),
    };
    this.socket = null;
    this.buffer = '';
    this.tagSeq = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const onReady = () => {
        if (this.socket) this.socket.removeListener('error', onError);
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
      const deadline = Date.now() + this.cfg.timeoutMs;
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

  async close() {
    if (!this.socket || this.socket.destroyed) return;
    try {
      this.socket.write('A99 LOGOUT\r\n');
    } catch (_) {}
    this.socket.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Standardize extracted notice fields into a canonical listing object
 */
function standardizeEmailNoticeListing(parsed = {}, meta = {}) {
  const state = parsed.state || meta.state || 'OH';
  const feedInfo = FEED_CONFIG[state] || null;
  const hash = meta.contentHash || hashNotice(meta.rawSnippet || parsed.property_address);
  const parcelIndex = Number(meta.parcelIndex || 0);
  const recordId = `email-notice-${state.toLowerCase()}-${hash.slice(0, 12)}-${parcelIndex}`;
  const publisherName = feedInfo?.name || feedInfo?.operator || `${state} Press Association`;
  const portalUrl = feedInfo?.portalUrl || `https://www.${PRESS_ASSOCIATION_DOMAINS[0]}`;
  const noticeUrl = `${portalUrl.replace(/\/+$/, '')}/notice/${recordId}`;
  const observedAt = meta.observedAt || new Date().toISOString();

  const openingBid = Number(parsed.opening_bid) > 0 ? Number(parsed.opening_bid) : null;
  const judgment = Number(parsed.judgment_amount) > 0 ? Number(parsed.judgment_amount) : null;

  return {
    id: recordId,
    source: 'email-notices',
    state,
    county: parsed.county || null,
    city: parsed.city || null,
    zip: parsed.zip || null,
    address: parsed.property_address || '',
    openingBid,
    judgment,
    saleDate: parsed.sale_date || null,
    plaintiff: parsed.plaintiff_or_seller || null,
    defendant: parsed.defendant || null,
    status: parsed.status || 'scheduled',
    seniorLienRisk: parsed.senior_lien_risk || null,
    seniorLienWarning: parsed.senior_lien_warning || null,
    redemptionDays: Number.isFinite(parsed.redemption_days) ? parsed.redemption_days : 0,
    redemptionWarning: parsed.redemption_warning || null,
    sourceUrl: noticeUrl,
    raw: meta.rawSnippet || JSON.stringify(parsed),
    sourceObservedAt: observedAt,
    provenance: {
      origin: 'email_notice',
      observed: true,
      publisher: publisherName,
      recordId,
      observedAt,
      exactSourceUrl: noticeUrl,
      sourceFacts: {
        caseNumber: parsed.case_number || null,
        statutoryAuthority: feedInfo?.statute || null,
        emailId: meta.emailId || null,
        emailSubject: meta.emailSubject || null,
        sender: meta.sender || null,
        parcelIndex,
        totalParcels: meta.totalParcels || 1,
      },
    },
  };
}

class EmailNoticesPipeline {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.db = options.db || defaultDb;
    this.transport = options.transport || null;
    this.imapClient = options.imapClient || null;
    this.allowedDomains = options.allowedDomains || PRESS_ASSOCIATION_DOMAINS;
    this.now = options.now || (() => new Date());
    this.maxMessages = Number(options.maxMessages || this.env.IMAP_MAX_MESSAGES || 50);

    const host = options.host || this.env.IMAP_HOST || '';
    const user = options.user || this.env.IMAP_USER || '';
    const pass = options.password || options.pass || this.env.IMAP_PASSWORD || this.env.IMAP_PASS || '';
    const port = Number(options.port || this.env.IMAP_PORT || 993);
    const tlsFlag = options.tls !== undefined ? options.tls : String(this.env.IMAP_TLS || 'true').toLowerCase() !== 'false';
    const mailbox = options.mailbox || this.env.IMAP_MAILBOX || 'INBOX';

    this.config = { host, user, pass, port, tls: tlsFlag, mailbox };
  }

  isConfigured() {
    if (this.transport) return true;
    if (this.imapClient) return true;
    return Boolean(this.config.host && this.config.user && this.config.pass);
  }

  checkCredentials() {
    if (!this.isConfigured()) {
      throw new ImapCredentialsUnsetError();
    }
  }

  async fetchUnreadNotices() {
    this.checkCredentials();

    // 1. Dependency-injected transport path
    if (this.transport) {
      if (typeof this.transport.fetchUnreadNotices === 'function') {
        return this.transport.fetchUnreadNotices({
          domains: this.allowedDomains,
          maxMessages: this.maxMessages,
        });
      }
      if (typeof this.transport.getUnreadMessages === 'function') {
        const rawList = await this.transport.getUnreadMessages({
          domains: this.allowedDomains,
          maxMessages: this.maxMessages,
        });
        return (rawList || []).filter((msg) => isFromPressAssociation(msg.from, this.allowedDomains));
      }
      if (typeof this.transport.fetchMessages === 'function') {
        const rawList = await this.transport.fetchMessages({
          unseenOnly: true,
          domains: this.allowedDomains,
        });
        return (rawList || []).filter((msg) => isFromPressAssociation(msg.from, this.allowedDomains));
      }
    }

    // 2. Dependency-injected IMAP client with high-level methods
    if (this.imapClient && typeof this.imapClient.fetchUnreadNotices === 'function') {
      return this.imapClient.fetchUnreadNotices({
        domains: this.allowedDomains,
        maxMessages: this.maxMessages,
      });
    }

    // 3. IMAP protocol execution (either injected low-level client or built-in client)
    const client = this.imapClient || new DefaultImapClient(this.config);
    try {
      if (typeof client.connect === 'function') await client.connect();
      if (typeof client.command === 'function') {
        await client.command(`LOGIN ${this.config.user} ${JSON.stringify(this.config.pass)}`);
        await client.command(`SELECT ${this.config.mailbox}`);
        const searchOut = await client.command('UID SEARCH UNSEEN', 'A');
        const uidLine = (searchOut.split(/\r?\n/).find((l) => /SEARCH/i.test(l)) || '').trim();
        const uids = (uidLine.match(/\d+/g) || [])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, this.maxMessages);

        const messages = [];
        for (const uid of uids) {
          let fetchOut;
          try {
            fetchOut = await client.command(`UID FETCH ${uid} (BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY[TEXT])`);
          } catch (_) {
            continue;
          }

          const rawText = String(fetchOut || '');
          const fromMatch = rawText.match(/From:\s*(.*)/i);
          const subjectMatch = rawText.match(/Subject:\s*(.*)/i);
          const dateMatch = rawText.match(/Date:\s*(.*)/i);
          const msgIdMatch = rawText.match(/Message-ID:\s*(.*)/i);

          const from = fromMatch ? fromMatch[1].trim() : '';
          const subject = subjectMatch ? subjectMatch[1].trim() : '';
          const date = dateMatch ? dateMatch[1].trim() : '';
          const messageId = msgIdMatch ? msgIdMatch[1].trim() : `imap-${uid}`;

          if (!isFromPressAssociation(from, this.allowedDomains)) {
            continue;
          }

          const bodyIdx = rawText.indexOf('\r\n\r\n') >= 0 ? rawText.indexOf('\r\n\r\n') + 4 : rawText.indexOf('\n\n') + 2;
          const body = bodyIdx > 1 ? rawText.slice(bodyIdx).replace(/\)\s*A\d+\s+OK[^\r\n]*/i, '').trim() : rawText;

          messages.push({
            id: messageId,
            from,
            subject,
            date,
            body,
            uid,
          });

          try {
            await client.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
          } catch (_) {}
        }
        return messages;
      }
      return [];
    } finally {
      if (typeof client.close === 'function') {
        await client.close().catch(() => {});
      }
    }
  }

  processEmail(email = {}) {
    const rawBody = String(email.body || '');
    const state = detectNoticeState(email);
    const feedInfo = FEED_CONFIG[state] || null;

    // 1. Defend against prompt injection and normalize OCR text
    const safeText = neutralizePromptInjection(rawBody);
    const normalizedText = normalizeOcrText(safeText);

    // 2. Disambiguate multi-parcel dockets
    const parcelSnippets = splitMultiParcelNotice(normalizedText);
    const listings = [];
    const observedAt = new Date(this.now()).toISOString();

    for (let i = 0; i < parcelSnippets.length; i++) {
      const snippet = parcelSnippets[i];
      const parsed = deterministicParse(snippet);

      if (state !== 'UNKNOWN' && (!parsed.state || parsed.state === 'OH')) {
        parsed.state = state;
      }

      const contentHash = hashNotice(snippet);
      const listing = standardizeEmailNoticeListing(parsed, {
        state,
        contentHash,
        parcelIndex: i,
        totalParcels: parcelSnippets.length,
        rawSnippet: snippet,
        emailId: email.id || null,
        emailSubject: email.subject || null,
        sender: email.from || null,
        observedAt,
      });

      listings.push(listing);
    }

    return {
      state,
      feedInfo,
      listings,
    };
  }

  async ingest() {
    this.checkCredentials();

    let unreadMessages = [];
    try {
      unreadMessages = await this.fetchUnreadNotices();
    } catch (err) {
      if (err instanceof ImapCredentialsUnsetError) throw err;
      throw new Error(`IMAP ingestion failed: ${err.message}`);
    }

    const report = {
      ok: true,
      messagesFound: unreadMessages.length,
      listingsGenerated: 0,
      listingsAccepted: 0,
      listingsRejected: 0,
      upserted: [],
      rejected: [],
      errors: [],
    };

    for (const email of unreadMessages) {
      try {
        const { listings } = this.processEmail(email);
        report.listingsGenerated += listings.length;

        for (const candidate of listings) {
          const validation = validateListingForIngestion(candidate, { expectedSource: 'email-notices' });
          if (!validation.isValid) {
            report.listingsRejected += 1;
            report.rejected.push({
              id: candidate.id,
              errors: validation.errors,
              address: candidate.address,
            });
            continue;
          }

          let saved;
          if (typeof this.db.createListing === 'function') {
            saved = await this.db.createListing(validation.listing);
          } else if (typeof this.db.upsertListing === 'function') {
            saved = await this.db.upsertListing(validation.listing);
          } else {
            saved = validation.listing;
          }

          report.listingsAccepted += 1;
          report.upserted.push(saved || validation.listing);
        }
      } catch (err) {
        report.errors.push({ emailId: email.id, error: err.message });
      }
    }

    return report;
  }
}

async function collectEmailNotices(options = {}) {
  const pipeline = new EmailNoticesPipeline(options);
  return pipeline.ingest();
}

module.exports = {
  EmailNoticesPipeline,
  collectEmailNotices,
  ImapCredentialsUnsetError,
  PRESS_ASSOCIATION_DOMAINS,
  FEED_CONFIG,
  detectNoticeState,
  isFromPressAssociation,
  standardizeEmailNoticeListing,
  DefaultImapClient,
};
