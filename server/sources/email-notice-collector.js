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

const FEED_CONFIG = emailFeeds.feeds || {};
const CONFIDENCE_THRESHOLD = 0.85;

function hashNotice(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * Detect state from email metadata (sender domain, subject, or body cues)
 */
function detectNoticeState(email = {}) {
  const from = String(email.from || '').toLowerCase();
  const subject = String(email.subject || '').toUpperCase();
  const body = String(email.body || '').toUpperCase();

  for (const [st, config] of Object.entries(FEED_CONFIG)) {
    for (const domain of config.senderDomains || []) {
      if (from.includes(domain.toLowerCase())) return st;
    }
  }

  // Check state abbreviations or full names in subject
  for (const st of Object.keys(FEED_CONFIG)) {
    if (new RegExp(`\\b${st}\\b`, 'i').test(subject)) return st;
  }

  // Look for state statute references in text
  for (const [st, config] of Object.entries(FEED_CONFIG)) {
    if (config.statute && body.includes(config.statute.toUpperCase())) return st;
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
  const state = detectNoticeState(email);
  const feedInfo = FEED_CONFIG[state] || null;

  // 1. Defend against prompt injection and normalize OCR text
  const safeText = neutralizePromptInjection(rawBody);
  const normalizedText = normalizeOcrText(safeText);

  // 2. Disambiguate multi-parcel dockets
  const parcelSnippets = splitMultiParcelNotice(normalizedText);
  const records = [];

  for (let i = 0; i < parcelSnippets.length; i++) {
    const snippet = parcelSnippets[i];
    const parsed = deterministicParse(snippet);

    if (state !== 'UNKNOWN' && (!parsed.state || parsed.state === 'OH')) {
      parsed.state = state;
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
      confidentListings.push({
        id: record.id,
        source: 'email-notices',
        sourceUrl: record.feedInfo ? record.feedInfo.portalUrl : 'https://publicnotice.org',
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
