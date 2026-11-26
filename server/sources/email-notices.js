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

const fs = require('node:fs');
const path = require('node:path');
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
  parseLegalNoticeAsync,
} = require('../ai/notice-parser');
const { detectNoticeState, evaluateNoticeConfidence, CONFIDENCE_THRESHOLD } = require('./email-notice-collector');
const { getStore, documentId } = require('../routes/document-review');
const { validateListingForIngestion } = require('../scrapers/validation');
const {
  parseRfc822,
  findTaggedImapResponse,
  parseImapSearchUids,
  extractImapFetchPayload,
} = require('../scrapers/email-ingest');
const defaultDb = require('../db/client');
const { defaultVault } = require('../storage/document-vault');

const CANONICAL_SOURCE_KEY = 'public-notices-email';
const FEED_CONFIG = emailFeeds.feeds || {};

function canonicalizeEmailSourceKey(source) {
  const norm = String(source || '').trim().toLowerCase();
  if (!norm || norm === 'email-notices' || norm === 'press-association-email' || norm === CANONICAL_SOURCE_KEY) {
    return CANONICAL_SOURCE_KEY;
  }
  return norm;
}

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
    this._rawBuffer = Buffer.alloc(0);
    this.tagSeq = 0;
    this.lastSocketError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const onReady = () => {
        if (this.socket) {
          this.socket.removeListener('error', onError);
          this.socket.on('error', (err) => {
            this.lastSocketError = err;
          });
        }
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
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.cfg.timeoutMs;
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

  async close() {
    if (!this.socket || this.socket.destroyed) return;
    this.tagSeq += 1;
    const tag = `A${this.tagSeq}`;
    try {
      this.socket.write(`${tag} LOGOUT\r\n`);
    } catch (_) {}
    try { this.socket.end(); } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { if (this.socket && !this.socket.destroyed) this.socket.destroy(); } catch (_) {}
  }
}

/**
 * Standardize extracted notice fields into a canonical listing object
 */
async function standardizeEmailNoticeListing(parsed = {}, meta = {}) {
  const rawState = parsed.state || meta.state || 'UNKNOWN';
  const state = String(rawState).trim().toUpperCase() || 'UNKNOWN';
  const stateSlug = state === 'UNKNOWN' ? 'unknown' : state.toLowerCase();
  const sourceKey = canonicalizeEmailSourceKey(meta.source);
  const feedInfo = FEED_CONFIG[state] || null;
  const hash = meta.contentHash || hashNotice(meta.rawSnippet || parsed.property_address);
  const parcelIndex = Number(meta.parcelIndex || 0);
  const recordId = `email-notice-${stateSlug}-${hash.slice(0, 12)}-${parcelIndex}`;
  const publisherName = feedInfo?.name || feedInfo?.operator || (state === 'UNKNOWN' ? 'Press Association Notice' : `${state} Press Association`);
  const noticeUrl = (typeof parsed.source_url === 'string' && /^https?:\/\//i.test(parsed.source_url))
    ? parsed.source_url
    : (feedInfo?.portalUrl || null);
  const observedAt = meta.observedAt || new Date().toISOString();

  const openingBid = Number(parsed.opening_bid) > 0 ? Number(parsed.opening_bid) : null;
  const judgment = Number(parsed.judgment_amount) > 0 ? Number(parsed.judgment_amount) : null;

  if (meta.rawSnippet && meta.skipVault !== true && meta.vault !== null) {
    const targetVault = meta.vault || defaultVault;
    if (targetVault && typeof targetVault.putDocument === 'function') {
      try {
        await targetVault.putDocument(`reviews/${encodeURIComponent(recordId)}.txt`, meta.rawSnippet, {
          contentType: 'text/plain',
          metadata: { recordId, source: sourceKey },
        });
      } catch (_) {}
    }
  }

  return {
    id: recordId,
    source: sourceKey,
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
        documents: [
          {
            title: `Statutory Legal Notice Evidence - ${parsed.case_number || recordId}`,
            url: noticeUrl,
            rawText: meta.rawSnippet || parsed.raw || null,
            evidenceSpans: parsed.evidenceSpans || parsed.evidence_spans || {},
            confidenceScore: typeof parsed.confidence_score === 'number' ? parsed.confidence_score : null,
          },
        ],
      },
    },
  };
}

class EmailNoticesPipeline {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.db = options.database || options.db || defaultDb;
    this.sourceKey = canonicalizeEmailSourceKey(options.sourceKey || options.source);
    this.corpusDir = options.corpusDir || this.env.IMAP_CORPUS_DIR || null;
    this.transport = options.transport || null;
    this.imapClient = options.imapClient || null;
    this.allowedDomains = options.allowedDomains || PRESS_ASSOCIATION_DOMAINS;
    this.now = options.now || (() => new Date());
    this.maxMessages = Number(options.maxMessages || this.env.IMAP_MAX_MESSAGES || 50);
    this.vault = options.vault !== undefined ? options.vault : defaultVault;
    this.documentReviewStore = options.documentReviewStore || options.store || null;
    this._activeImapClient = null;
    this.allowAiFallback = options.allowAiFallback !== undefined
      ? Boolean(options.allowAiFallback)
      : this.env.EMAIL_NOTICE_AI_FALLBACK === '1';
    this.aiParser = typeof options.aiParser === 'function' ? options.aiParser : null;

    const host = options.host || this.env.IMAP_HOST || '';
    const user = options.user || this.env.IMAP_USER || '';
    const pass = options.password || options.pass || this.env.IMAP_PASSWORD || this.env.IMAP_PASS || '';
    const port = Number(options.port || this.env.IMAP_PORT || 993);
    const tlsFlag = options.tls !== undefined ? options.tls : String(this.env.IMAP_TLS || 'true').toLowerCase() !== 'false';
    const mailbox = options.mailbox || this.env.IMAP_MAILBOX || 'INBOX';

    this.config = { host, user, pass, port, tls: tlsFlag, mailbox };
  }

  async closeActiveImapClient() {
    const client = this._activeImapClient;
    this._activeImapClient = null;
    if (client && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }

  isConfigured() {
    if (this.corpusDir && fs.existsSync(this.corpusDir)) return true;
    if (this.transport) return true;
    if (this.imapClient) return true;
    return Boolean(this.config.host && this.config.user && this.config.pass);
  }

  checkCredentials() {
    if (!this.isConfigured()) {
      throw new ImapCredentialsUnsetError();
    }
  }

  async fetchUnreadNotices(options = {}) {
    this.checkCredentials();
    const deferClose = Boolean(options.deferClose);

    // 0. Local fixture corpus directory
    if (this.corpusDir && fs.existsSync(this.corpusDir)) {
      const files = fs.readdirSync(this.corpusDir).filter((f) => /\.(eml|txt)$/i.test(f));
      const messages = [];
      for (const file of files) {
        const raw = fs.readFileSync(path.join(this.corpusDir, file), 'utf8');
        const parsed = parseRfc822(raw);
        if (!parsed.subject && !parsed.body) continue;
        messages.push({
          id: parsed.messageId || file,
          from: parsed.from,
          subject: parsed.subject,
          date: parsed.date,
          body: parsed.body,
        });
      }
      return messages.filter((msg) => !msg.from || isFromPressAssociation(msg.from, this.allowedDomains));
    }

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
    let keepOpen = false;
    try {
      if (typeof client.connect === 'function') await client.connect();
      if (typeof client.command === 'function') {
        await client.command(`LOGIN ${this.config.user} ${JSON.stringify(this.config.pass)}`);
        await client.command(`SELECT ${this.config.mailbox}`);
        const searchOut = await client.command('UID SEARCH UNSEEN');
        const uids = parseImapSearchUids(searchOut, this.maxMessages);

        const messages = [];
        for (const uid of uids) {
          let fetchOut;
          try {
            fetchOut = await client.command(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT])`);
          } catch (_) {
            continue;
          }

          const payload = extractImapFetchPayload(fetchOut);
          const parsedMsg = parseRfc822(payload);
          const rawText = String(fetchOut || '');
          const from = parsedMsg.from || (rawText.match(/^From:\s*(.*)$/im)?.[1] || '').trim();
          const subject = parsedMsg.subject || (rawText.match(/^Subject:\s*(.*)$/im)?.[1] || '').trim();
          const date = parsedMsg.date || (rawText.match(/^Date:\s*(.*)$/im)?.[1] || '').trim();
          const messageId = parsedMsg.messageId || (rawText.match(/^Message-ID:\s*(.*)$/im)?.[1] || '').trim() || `imap-${uid}`;

          if (!isFromPressAssociation(from, this.allowedDomains)) {
            continue;
          }

          let body = parsedMsg.body || '';
          if (!body) {
            const bodyIdx = rawText.indexOf('\r\n\r\n') >= 0 ? rawText.indexOf('\r\n\r\n') + 4 : rawText.indexOf('\n\n') + 2;
            body = bodyIdx > 1
              ? rawText.slice(bodyIdx).replace(/\)\s*(?:\r?\n)?[A-Za-z0-9._-]+\s+OK[^\r\n]*/i, '').trim()
              : rawText;
          }

          messages.push({
            id: messageId,
            from,
            subject,
            date,
            body,
            uid,
          });
        }
        if (deferClose) {
          this._activeImapClient = client;
          keepOpen = true;
        }
        return messages;
      }
      return [];
    } finally {
      if (!keepOpen && typeof client.close === 'function') {
        await client.close().catch(() => {});
      }
    }
  }

  async processEmail(email = {}) {
    const rawBody = String(email.body || '');
    const state = detectNoticeState(email);
    const feedInfo = FEED_CONFIG[state] || null;

    // Detect adversarial prompt injection patterns before sanitization
    const injectionPatterns = [
      /ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions|directives|prompts|rules)/gi,
      /disregard\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions|directives|prompts|rules)/gi,
      /system\s+(?:instruction|prompt|directive):?/gi,
      /override\s+(?:all\s+)?prior\s+rules/gi,
      /you\s+must\s+output\s+deal\s+score\s+[0-9]+/gi,
      /tell\s+the\s+user\s+this\s+property\s+has\s+\$?[0-9,]+\s+equity/gi
    ];
    const xmlInjectionPattern = /<\/?(raw_legal_notice|system|system_prompt|instruction|context|prompt|script)[^>]*>/gi;
    const hasAdversarialPayload = injectionPatterns.some((p) => p.test(rawBody)) || xmlInjectionPattern.test(rawBody);

    // 1. Defend against prompt injection and normalize OCR text
    const safeText = neutralizePromptInjection(rawBody);
    const normalizedText = normalizeOcrText(safeText);

    // 2. Disambiguate multi-parcel dockets
    const parcelSnippets = splitMultiParcelNotice(normalizedText);
    const listings = [];
    const lowConfidenceNotices = [];
    const observedAt = new Date(this.now()).toISOString();

    for (let i = 0; i < parcelSnippets.length; i++) {
      const snippet = parcelSnippets[i];
      const preCheckAdversarial = hasAdversarialPayload ||
        injectionPatterns.some((p) => p.test(snippet)) ||
        snippet.includes('[REDACTED_ADVERSARIAL_PAYLOAD]');
      const parseFn = (this.allowAiFallback && !preCheckAdversarial)
        ? (this.aiParser || parseLegalNoticeAsync)
        : deterministicParse;
      const rawParsed = await parseFn(snippet, {
        allowAiFallback: Boolean(this.allowAiFallback && !preCheckAdversarial),
        db: this.db,
        database: this.db,
        defaultState: state !== 'UNKNOWN' ? state : null,
      });
      const parsed = Array.isArray(rawParsed) ? (rawParsed[0] || {}) : (rawParsed || {});

      const resolvedState = String(parsed.state || state || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
      if (!parsed.state && resolvedState !== 'UNKNOWN') {
        parsed.state = resolvedState;
      }

      const snippetHasAdversarial = hasAdversarialPayload ||
        injectionPatterns.some((p) => p.test(snippet)) ||
        snippet.includes('[REDACTED_ADVERSARIAL_PAYLOAD]');

      const evaluation = evaluateNoticeConfidence(parsed, {
        requireParcelId: true,
        requireVerifiedSpans: true,
        adversarialInjectionDetected: snippetHasAdversarial,
        rawText: snippet,
      });
      const reasons = Array.isArray(evaluation.reasons) ? [...evaluation.reasons] : [];
      let isConfident = Boolean(evaluation.isConfident);
      if (resolvedState === 'UNKNOWN') {
        isConfident = false;
        if (!reasons.includes('UNKNOWN_STATE')) {
          reasons.push('UNKNOWN_STATE');
        }
      }

      const contentHash = hashNotice(snippet);
      const listing = await standardizeEmailNoticeListing(
        { ...parsed, state: resolvedState },
        {
          state: resolvedState,
          source: this.sourceKey,
          skipVault: true,
          contentHash,
          parcelIndex: i,
          totalParcels: parcelSnippets.length,
          rawSnippet: snippet,
          emailId: email.id || null,
          emailSubject: email.subject || null,
          sender: email.from || null,
          observedAt,
        }
      );

      const snippetFeedInfo = FEED_CONFIG[resolvedState] || feedInfo || null;
      const noticeUrl = listing.sourceUrl || snippetFeedInfo?.portalUrl || null;

      if (isConfident) {
        listings.push(listing);
      } else {
        lowConfidenceNotices.push({
          id: listing.id,
          recordId: listing.id,
          noticeUrl,
          state: resolvedState,
          reasons,
          rawSnippet: snippet,
          contentHash,
          observedAt,
          parsed,
          listing,
          email,
          confidence: evaluation.confidence,
        });
      }
    }

    return {
      state,
      feedInfo,
      listings,
      lowConfidenceNotices,
    };
  }

  async ingestRawEmail(input, options = {}) {
    let message = null;
    if (typeof input === 'string') {
      const parsed = parseRfc822(input);
      message = {
        id: options.id || parsed.messageId || `raw-${hashNotice(input).slice(0, 12)}`,
        from: options.from || parsed.from || '',
        subject: options.subject || parsed.subject || '',
        date: options.date || parsed.date || new Date(this.now()).toISOString(),
        body: parsed.body || '',
      };
    } else if (input && typeof input === 'object') {
      const rawMime = input.raw || input.rawMime || input.mime || '';
      const parsed = rawMime ? parseRfc822(rawMime) : {};
      message = {
        id: input.id || input.messageId || parsed.messageId || `raw-${hashNotice(rawMime || input.body || input.text || '').slice(0, 12)}`,
        from: input.from || parsed.from || '',
        subject: input.subject || parsed.subject || '',
        date: input.date || parsed.date || new Date(this.now()).toISOString(),
        body: input.body || input.text || parsed.body || '',
      };
    } else {
      throw new Error('ingestRawEmail requires a raw MIME string or message object');
    }
    return this.ingestMessages([message], options);
  }

  async ingestMessages(messages = [], options = {}) {
    const list = Array.isArray(messages) ? messages.filter(Boolean) : [messages].filter(Boolean);
    return this._ingestBatch(list, { ...options, markImapSeen: false });
  }

  async ingest() {
    this.checkCredentials();

    let unreadMessages = [];
    try {
      unreadMessages = await this.fetchUnreadNotices({ deferClose: true });
    } catch (err) {
      await this.closeActiveImapClient();
      if (err instanceof ImapCredentialsUnsetError) throw err;
      throw new Error(`IMAP ingestion failed: ${err.message}`);
    }

    try {
      return await this._ingestBatch(unreadMessages, { markImapSeen: true });
    } finally {
      await this.closeActiveImapClient();
    }
  }

  async _ingestBatch(unreadMessages = [], options = {}) {
    const reviewStore = this.documentReviewStore || (typeof getStore === 'function' ? getStore(this.db) : null);

    const report = {
      ok: true,
      source: this.sourceKey,
      messagesFound: unreadMessages.length,
      listingsGenerated: 0,
      listingsAccepted: 0,
      listingsRejected: 0,
      reviewsRouted: 0,
      upserted: [],
      rejected: [],
      reviews: [],
      errors: [],
    };

    try {
      if (reviewStore && typeof reviewStore.loadPg === 'function') {
        try {
          await reviewStore.loadPg();
        } catch (loadErr) {
          report.errors.push({ stage: 'reviewStore.loadPg', error: loadErr.message });
        }
      }

      const emailPersistStatus = [];

      for (const email of unreadMessages) {
        const uid = Number.isInteger(email?.uid) && email.uid > 0 ? email.uid : null;
        let emailListingsSaved = 0;
        let emailHasReviews = false;
        let emailError = false;
        try {
          const { listings, lowConfidenceNotices } = await this.processEmail(email);
          report.listingsGenerated += (listings.length + (lowConfidenceNotices?.length || 0));

          for (const candidate of listings) {
            const validation = validateListingForIngestion(candidate, { expectedSource: this.sourceKey });
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

            if (saved === false || saved?.ok === false) {
              throw new Error(`Listing persistence failed for ${validation.listing.id}`);
            }

            emailListingsSaved += 1;
            report.listingsAccepted += 1;
            report.upserted.push(saved || validation.listing);
          }

          for (const item of (lowConfidenceNotices || [])) {
            const docId = typeof documentId === 'function'
              ? documentId(item.recordId, 0, item.noticeUrl)
              : item.recordId;
            const vault = this.vault;
            if (vault && item.rawSnippet) {
              try {
                if (typeof vault.putDocument === 'function') {
                  await vault.putDocument(`reviews/${encodeURIComponent(docId)}.txt`, item.rawSnippet, {
                    contentType: 'text/plain',
                    metadata: { recordId: item.recordId, source: this.sourceKey, reason: 'LOW_CONFIDENCE_NOTICE' },
                  });
                }
              } catch (_) {}
            }

            const existingReview = reviewStore && reviewStore.map ? reviewStore.map.get(docId) : null;
            const preserveHumanDecision = Boolean(
              existingReview && (
                (existingReview.status && existingReview.status !== 'pending')
                || Number(existingReview.revision) > 0
              )
            );

            const reviewEntry = {
              ...(existingReview && typeof existingReview === 'object' ? existingReview : {}),
              id: docId,
              listingId: item.recordId,
              documentIndex: 0,
              documentUrl: item.noticeUrl,
              status: preserveHumanDecision ? existingReview.status : 'pending',
              reason: 'LOW_CONFIDENCE_NOTICE',
              reasons: item.reasons,
              notes: preserveHumanDecision
                ? existingReview.notes
                : `LOW_CONFIDENCE_NOTICE: ${item.reasons.join(', ')}`,
              reviewer: preserveHumanDecision ? existingReview.reviewer : null,
              reviewedAt: preserveHumanDecision ? existingReview.reviewedAt : null,
              revision: Number.isInteger(existingReview?.revision) && existingReview.revision >= 0
                ? existingReview.revision
                : 0,
              priorStatus: preserveHumanDecision ? (existingReview.priorStatus ?? null) : null,
              extractedAt: existingReview?.extractedAt || item.observedAt,
              contentHash: item.contentHash,
              rawText: item.rawSnippet,
              extractedFields: {
                property_address: item.parsed.property_address || '',
                address: item.parsed.property_address || '',
                caseNumber: item.parsed.case_number || '',
                apn: item.parsed.apn || '',
                plaintiff: item.parsed.plaintiff_or_seller || '',
                defendant: item.parsed.defendant || '',
                judgmentAmount: item.parsed.judgment_amount || 0,
                openingBid: item.parsed.opening_bid || 0,
                saleDate: item.parsed.sale_date || '',
                depositTerms: item.parsed.deposit_terms || '',
                state: item.parsed.state || item.state,
                county: item.parsed.county || '',
                city: item.parsed.city || '',
                zip: item.parsed.zip || '',
                confidenceScore: item.parsed.confidence_score,
                evidenceSpans: item.parsed.evidenceSpans || item.parsed.evidence_spans || {},
              },
            };

            if (reviewStore && reviewStore.map) {
              reviewStore.map.set(docId, reviewEntry);
            }

            emailHasReviews = true;
            report.reviewsRouted += 1;
            report.reviews.push(reviewEntry);
          }
        } catch (err) {
          emailError = true;
          report.errors.push({ emailId: email.id, error: err.message });
        }

        if (uid) {
          emailPersistStatus.push({
            uid,
            emailListingsSaved,
            emailHasReviews,
            emailError,
          });
        }
      }

      let reviewsPersisted = Boolean(reviewStore);
      if (reviewStore && report.reviewsRouted > 0) {
        try {
          if (typeof reviewStore.persistAsync === 'function') {
            const persisted = await reviewStore.persistAsync();
            if (persisted === false) reviewsPersisted = false;
          } else if (typeof reviewStore.persist === 'function') {
            const persisted = reviewStore.persist();
            if (persisted === false) reviewsPersisted = false;
          }
        } catch (persistErr) {
          reviewsPersisted = false;
          report.errors.push({ stage: 'reviewStore.persist', error: persistErr.message });
        }
      }

      if (options.markImapSeen && this._activeImapClient && typeof this._activeImapClient.command === 'function') {
        for (const item of emailPersistStatus) {
          if (item.emailError) continue;
          const durablyHandled = item.emailHasReviews
            ? reviewsPersisted
            : item.emailListingsSaved > 0;
          if (!durablyHandled) continue;
          try {
            await this._activeImapClient.command(`UID STORE ${item.uid} +FLAGS (\\Seen)`);
          } catch (_) {}
        }
      }
    } finally {
      // Caller (ingest) closes active IMAP client when markImapSeen is enabled.
    }

    report.accepted = report.listingsAccepted;
    report.evidencePackets = report.listingsGenerated;
    report.publicationStatus = 'evidence_only';

    return report;
  }
}

async function collectEmailNotices(options = {}) {
  const pipeline = new EmailNoticesPipeline(options);
  return pipeline.ingest();
}

module.exports = {
  CANONICAL_SOURCE_KEY,
  canonicalizeEmailSourceKey,
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
