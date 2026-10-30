'use strict';

/**
 * server/sources/email-notice-collector.js
 *
 * Statewide Press Association Statutory Legal Notice Collector (Email-as-API).
 * Ingests free statutory email alerts without scraping anti-bot publisher portals.
 * Normalizes OCR artifacts, enforces prompt injection defense, extracts structured
 * foreclosure records, and routes low-confidence notices to the Document Review Queue.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const emailFeeds = require('./email-feeds.json');
const {
  normalizeOcrText,
  neutralizePromptInjection,
  splitMultiParcelNotice,
  deterministicParse,
} = require('../ai/notice-parser');
const { getRedemptionRule } = require('../ai/legal-rules');

const FEED_CONFIG = emailFeeds.feeds || {};
const CONFIDENCE_THRESHOLD = 0.85;

const STATE_NAMES = Object.freeze({
  CA: 'CALIFORNIA',
  NY: 'NEW YORK',
  NJ: 'NEW JERSEY',
  MI: 'MICHIGAN',
  NC: 'NORTH CAROLINA',
  AZ: 'ARIZONA',
  CO: 'COLORADO',
  IN: 'INDIANA',
  FL: 'FLORIDA',
  IL: 'ILLINOIS',
  TX: 'TEXAS',
  OH: 'OHIO',
  PA: 'PENNSYLVANIA',
  GA: 'GEORGIA',
});

const STATUTE_PATTERNS = Object.freeze({
  CA: /\b(?:CAL(?:\.|\s+)?CIV(?:\.|\s+)?CODE|CAL(?:\.|\s+)?GOV(?:\.|\s+)?CODE|CIVIL\s+CODE)\s*(?:§|SEC\.?|SECTION)?\s*(?:2924[a-z]?|6000)\b/i,
  NY: /\b(?:RPAPL|N\.?Y\.?\s+REAL\s+PROP(?:\.|\s+)?ACTS(?:\.|\s+)?LAW)\s*(?:§|SEC\.?|SECTION)?\s*(?:231|135[1-4])\b/i,
  NJ: /\b(?:N\.?J\.?\s*(?:STAT\.?|STATUTE|S\.?A\.?)\s*(?:§|SEC\.?|SECTION)?\s*2A:(?:61-1|50-5)|N\.?J\.?\s*CT\.?\s*R\.?\s*4:65-5)\b/i,
  MI: /\b(?:MICH(?:\.|\s+)?COMP(?:\.|\s+)?LAWS|MCL)\s*(?:§|SEC\.?|SECTION)?\s*600\.(?:3208|3240)\b/i,
  NC: /\b(?:N\.?C\.?\s*GEN(?:\.|\s+)?STAT\.?|N\.?C\.?G\.?S\.?|NCGS)\s*(?:§|SEC\.?|SECTION)?\s*45-21\.(?:17|27)\b/i,
  AZ: /\b(?:ARIZ(?:\.|\s+)?REV(?:\.|\s+)?STAT\.?|A\.?R\.?S\.?)\s*(?:§|SEC\.?|SECTION)?\s*(?:33-808|12-1282)\b/i,
  CO: /\b(?:COLO(?:\.|\s+)?REV(?:\.|\s+)?STAT\.?|C\.?R\.?S\.?)\s*(?:§|SEC\.?|SECTION)?\s*38-38-(?:101|302|501)\b/i,
  IN: /\b(?:IND(?:\.|\s+)?CODE|I\.?C\.?)\s*(?:§|SEC\.?|SECTION)?\s*32-29-7-(?:3|7)\b/i,
  IL: /\b735\s+ILCS\s+5\/15-(?:1507|1603)\b/i,
  TX: /\bTEX(?:\.|\s+)?PROP(?:\.|\s+)?CODE\s*(?:§|SEC\.?|SECTION)?\s*51\.00[23]\b/i,
  FL: /\bFLA(?:\.|\s+)?STAT(?:\.|\s+)?\s*(?:§|SEC\.?|SECTION)?\s*(?:50\.011|45\.0315)\b/i,
  OH: /\b(?:OHIO\s+REV(?:\.|\s+)?CODE|R\.?C\.?)\s*(?:§|SEC\.?|SECTION)?\s*2329\.(?:26|33)\b/i,
  PA: /\b(?:PA\.?\s*R\.?\s*CIV\.?\s*P\.?\s*3129\.2|53\s+P\.?S\.?\s*(?:§|SEC\.?|SECTION)?\s*7293)\b/i,
  GA: /\bO\.?C\.?G\.?A\.?\s*(?:§|SEC\.?|SECTION)?\s*(?:44-14-162|48-4-40)\b/i,
});

function hashNotice(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * Detect state from email metadata (sender domain, subject regexes, or statute citations)
 */
function detectNoticeState(email = {}) {
  const from = String(email.from || '').toLowerCase();
  const rawSubject = String(email.subject || '');
  const subject = rawSubject.toUpperCase();
  const rawBody = String(email.body || '');
  const body = rawBody.toUpperCase();

  // 1. Sender domain lookups across all feeds
  for (const [st, config] of Object.entries(FEED_CONFIG)) {
    for (const domain of config.senderDomains || []) {
      const cleanDomain = String(domain || '').split('/')[0].trim().toLowerCase();
      if (cleanDomain && from.includes(cleanDomain)) return st;
    }
  }

  // 2. Full state name in subject
  for (const [st, stateName] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${stateName}\\b`, 'i').test(rawSubject)) return st;
  }

  // 3. Comma-separated state abbreviation in subject (e.g. "Columbus, OH" or "Marion County, IN")
  const commaStateMatch = rawSubject.match(/,\s*([A-Z]{2})\b/);
  if (commaStateMatch && FEED_CONFIG[commaStateMatch[1].toUpperCase()]) {
    return commaStateMatch[1].toUpperCase();
  }

  // 4. Two-letter postal code as standalone token in subject
  // Exclude 'IN' here to avoid false matching on English preposition 'in'
  for (const st of Object.keys(FEED_CONFIG)) {
    if (st === 'IN') continue;
    if (new RegExp(`\\b${st}\\b`, 'i').test(rawSubject)) return st;
  }

  // 5. Explicit check for IN state token (must be uppercase IN and not common preposition patterns)
  if (/\bIN\b/.test(rawSubject) && !/\bIN\s+(THE|A|AN|RE|PURSUANCE|ACCORDANCE|FORECLOSURE|EXECUTION|COMPLIANCE|COURT|DEFAULT)\b/i.test(rawSubject)) {
    return 'IN';
  }

  // 6. Look for exact state statute references in text
  for (const [st, config] of Object.entries(FEED_CONFIG)) {
    if (config.statute && body.includes(config.statute.toUpperCase())) return st;
    if (Array.isArray(config.statutes)) {
      for (const stat of config.statutes) {
        if (body.includes(String(stat).toUpperCase())) return st;
      }
    }
  }

  // 7. Look for statutory citation patterns across body and subject
  for (const [st, pattern] of Object.entries(STATUTE_PATTERNS)) {
    if (pattern.test(rawBody) || pattern.test(rawSubject)) return st;
  }

  // 8. Look for formal court / state references in body (e.g. "STATE OF CALIFORNIA", "SUPREME COURT ... NEW YORK")
  for (const [st, stateName] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b(?:STATE\\s+OF|COUNTY\\s+OF[\\w\\s,]+|COMMONWEALTH\\s+OF)\\s+${stateName}\\b`, 'i').test(rawBody)) {
      return st;
    }
  }

  // 9. Address state and zip code match in body fallback
  const addrMatch = rawBody.match(/,\s*([A-Z]{2})\s+(\d{5})\b/);
  if (addrMatch && FEED_CONFIG[addrMatch[1].toUpperCase()]) {
    return addrMatch[1].toUpperCase();
  }

  return 'UNKNOWN';
}

/**
 * Score the completeness and evidentiary reliability of an extracted legal notice
 */
function evaluateNoticeConfidence(parsed = {}) {
  let score = 0;
  const reasons = [];

  if (parsed.property_address && parsed.property_address.length > 5) {
    score += 0.35;
  } else {
    reasons.push('MISSING_PROPERTY_ADDRESS');
  }

  if (parsed.case_number && parsed.case_number.length >= 3) {
    score += 0.25;
  } else {
    reasons.push('MISSING_CASE_NUMBER');
  }

  if (parsed.sale_date && parsed.sale_date.length > 4) {
    score += 0.20;
  } else {
    reasons.push('MISSING_SALE_DATE');
  }

  if (parsed.plaintiff_or_seller || parsed.defendant) {
    score += 0.10;
  }

  if (parsed.judgment_amount > 0 || parsed.opening_bid > 0) {
    score += 0.10;
  }

  const confidence = Math.min(1.0, Math.round(score * 100) / 100);
  return {
    confidence,
    isConfident: confidence >= CONFIDENCE_THRESHOLD && Boolean(parsed.property_address),
    reasons,
  };
}

/**
 * Process a single email alert into one or more structured parcel records
 */
function parseNoticeEmail(email = {}, options = {}) {
  const rawBody = String(email.body || '');
  let state = detectNoticeState(email);
  let feedInfo = FEED_CONFIG[state] || null;

  // 1. Defend against prompt injection and normalize OCR text
  const safeText = neutralizePromptInjection(rawBody);
  const normalizedText = normalizeOcrText(safeText);

  // 2. Disambiguate multi-parcel dockets
  const parcelSnippets = splitMultiParcelNotice(normalizedText);
  const records = [];

  for (let i = 0; i < parcelSnippets.length; i++) {
    const snippet = parcelSnippets[i];
    const parsed = deterministicParse(snippet);

    if (state === 'UNKNOWN' && parsed.state && parsed.state !== 'OH' && FEED_CONFIG[parsed.state]) {
      state = parsed.state;
      feedInfo = FEED_CONFIG[state] || null;
    }

    if (state !== 'UNKNOWN' && (!parsed.state || parsed.state === 'OH')) {
      parsed.state = state;
    }

    if (state !== 'UNKNOWN') {
      const redemptionInfo = getRedemptionRule(state, { noticeText: snippet });
      parsed.redemption_days = redemptionInfo.days;
      parsed.redemption_warning = redemptionInfo.warning;
    }

    const evaluation = evaluateNoticeConfidence(parsed);
    const contentHash = hashNotice(snippet);
    const noticeId = `notice-${state.toLowerCase()}-${contentHash.slice(0, 12)}-${i}`;

    const record = {
      id: noticeId,
      source: 'public-notices-email',
      feedState: state,
      feedName: feedInfo ? feedInfo.name : 'Unspecified Press Feed',
      statutoryAuthority: feedInfo ? feedInfo.statute : null,
      emailId: email.id || null,
      emailSubject: email.subject || null,
      receivedAt: email.date || new Date().toISOString(),
      contentHash,
      parcelIndex: i,
      totalParcelsInNotice: parcelSnippets.length,
      parsed,
      confidence: evaluation.confidence,
      reasons: evaluation.reasons,
      reviewRequired: !evaluation.isConfident,
      reviewStatus: evaluation.isConfident ? 'AUTO_ACCEPTED' : 'PENDING_DOCUMENT_REVIEW',
      feedInfo,
    };

    records.push(record);
  }

  return {
    state,
    feedInfo,
    records,
    multiParcel: parcelSnippets.length > 1,
    totalRecords: records.length,
  };
}

/**
 * Route processed records into either the verified store or the operator review queue
 */
function routeNoticeResult(batchResult = {}, options = {}) {
  const confidentListings = [];
  const reviewQueueItems = [];

  for (const record of batchResult.records || []) {
    if (!record.reviewRequired) {
      const portalUrl = record.feedInfo?.portalUrl || batchResult.feedInfo?.portalUrl || 'https://publicnotice.org';
      confidentListings.push({
        id: record.id,
        source: 'email-notices',
        sourceUrl: portalUrl,
        state: record.parsed.state || record.feedState,
        address: record.parsed.property_address,
        city: record.parsed.city,
        zip: record.parsed.zip,
        caseNumber: record.parsed.case_number,
        plaintiff: record.parsed.plaintiff_or_seller,
        defendant: record.parsed.defendant,
        openingBid: record.parsed.opening_bid || null,
        judgment: record.parsed.judgment_amount || null,
        saleDate: record.parsed.sale_date,
        raw: record.contentHash,
      });
    } else {
      reviewQueueItems.push({
        reviewId: `rev-${record.id}`,
        source: 'email-notices',
        state: record.feedState,
        headline: record.emailSubject || `Legal Notice (${record.feedState})`,
        documentText: record.parsed.property_address || '[Unextracted Notice]',
        reasons: record.reasons,
        confidence: record.confidence,
        rawHash: record.contentHash,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return {
    confidentCount: confidentListings.length,
    reviewCount: reviewQueueItems.length,
    confidentListings,
    reviewQueueItems,
  };
}

module.exports = {
  FEED_CONFIG,
  CONFIDENCE_THRESHOLD,
  detectNoticeState,
  evaluateNoticeConfidence,
  parseNoticeEmail,
  routeNoticeResult,
};
