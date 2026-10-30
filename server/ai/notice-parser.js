/**
 * @file server/ai/notice-parser.js
 * Two-tier resilient legal notice parser with OCR normalization,
 * multi-parcel splitting, prompt injection defense, and air-gapped deterministic fallback.
 */

const { detectSeniorLienSurvival, getRedemptionRule, detectBankruptcyOrAdjournment } = require('./legal-rules');

/**
 * Normalizes common OCR artifacts in monetary and legal notice text.
 * e.g. "$12O,OOO.OO" -> "$120,000.00", "$4S,OOO" -> "$45,000"
 * @param {string} text
 * @returns {string} Cleaned text
 */
function normalizeOcrText(text = '') {
  if (!text) return '';

  let cleaned = String(text);

  // Fix currency strings with letter 'O'/'o' instead of zero '0'
  cleaned = cleaned.replace(/\$([0-9OoSs,\.]+)/g, (match, numGroup) => {
    let fixed = numGroup
      .replace(/[Oo]/g, '0')
      .replace(/[Ss]/g, '5');
    return `$${fixed}`;
  });

  // Fix "Jdgmt: $4S,OOO" or judgment labels
  cleaned = cleaned.replace(/Jdgmt:?\s*\$([0-9OoSs,\.]+)/gi, (match, numGroup) => {
    let fixed = numGroup
      .replace(/[Oo]/g, '0')
      .replace(/[Ss]/g, '5');
    return `Judgment: $${fixed}`;
  });

  return cleaned;
}

/**
 * Strips adversarial prompt injection payloads from unstructured text.
 * @param {string} text
 * @returns {string} Sanitized string
 */
function neutralizePromptInjection(text = '') {
  if (!text) return '';

  let sanitized = String(text);

  const injectionPatterns = [
    /ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions|directives|prompts|rules)/gi,
    /disregard\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions|directives|prompts|rules)/gi,
    /system\s+(?:instruction|prompt|directive):?/gi,
    /override\s+(?:all\s+)?prior\s+rules/gi,
    /you\s+must\s+output\s+deal\s+score\s+[0-9]+/gi,
    /tell\s+the\s+user\s+this\s+property\s+has\s+\$?[0-9,]+\s+equity/gi
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED_ADVERSARIAL_PAYLOAD]');
  }

  // Escape XML-like tags with any attributes
  sanitized = sanitized.replace(/<\/?(raw_legal_notice|system|system_prompt|instruction|context|prompt|script)[^>]*>/gi, '');

  return sanitized;
}

/**
 * Splits a legal notice containing multiple parcels into discrete parcel blocks.
 * Ignores preambles before the first parcel boundary.
 * @param {string} rawNotice
 * @returns {Array<string>} Array of parcel notice strings
 */
function splitMultiParcelNotice(rawNotice = '') {
  const normalized = normalizeOcrText(rawNotice);
  const parcelHeaderRegex = /(?:PARCEL|TRACT|ITEM)\s+(?:[0-9]+|[A-Z]|I|II|III|IV|V)\s*[:\-\.]/i;
  const parcelSplitter = /(?:^|\n|\.\s+)\s*(?=(?:PARCEL|TRACT|ITEM)\s+(?:[0-9]+|[A-Z]|I|II|III|IV|V)\s*[:\-\\.])/i;

  const rawParts = normalized.split(parcelSplitter).map(p => p.trim()).filter(Boolean);
  const parcelParts = rawParts.filter(part => parcelHeaderRegex.test(part));

  if (parcelParts.length > 1) {
    return parcelParts;
  }

  return [normalized];
}

/**
 * Verifies whether a candidate quote or value appears verbatim in raw text and returns its character span.
 * @param {string} rawText
 * @param {string|number} candidate
 * @param {number} [fromIndex=0]
 * @returns {{ quote: string, start: number, end: number, verified: boolean } | null}
 */
function verifyVerbatimSpan(rawText = '', candidate = '', fromIndex = 0) {
  if (!rawText || candidate === null || candidate === undefined || candidate === '') return null;
  const text = String(rawText);
  const query = String(candidate).trim();
  if (!query) return null;
  const start = text.indexOf(query, Math.max(0, fromIndex));
  if (start >= 0) {
    const end = start + query.length;
    return { quote: query, start, end, verified: text.slice(start, end) === query };
  }
  return null;
}

/**
 * Deterministic air-gapped parser that extracts key legal foreclosure attributes
 * via pure regex, without calling any external LLM APIs.
 * @param {string} rawNotice
 * @returns {object} Structured extracted notice
 */
function deterministicParse(rawNotice = '') {
  const clean = normalizeOcrText(neutralizePromptInjection(rawNotice));

  // Extract address pattern: e.g. "123 Main St, Columbus, OH 43215"
  const addressMatch = clean.match(/(\d+\s+[A-Za-z0-9\.\s,]+?,\s*([A-Za-z\s]+?),\s*([A-Z]{2})\s*(\d{5})?)/);
  // Extract Case Number: e.g. "Case No. 2024-CV-1092"
  const caseMatch = clean.match(/(?:case\s*(?:no\.?|#)|docket\s*#?)\s*([0-9A-Za-z\-\/]+)/i);
  // Extract Judgment Amount: e.g. "Judgment: $142,500.00" or "Judgment amount: $245,000.00"
  const judgmentMatch = clean.match(/(?:judgment(?:\s+amount)?|amount\s+due|debt)\s*(?:of|is|:)?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Extract Opening Bid: e.g. "Opening bid: $50,000" or "Minimum bid: $50,000"
  const bidMatch = clean.match(/(?:opening\s+bid|minimum\s+bid|upset\s+price|starting\s+bid)\s*(?:of|is|:)?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Extract Plaintiff: e.g. "Wells Fargo Bank, N.A. vs."
  const vsMatch = clean.match(/([A-Za-z0-9\s,\.\(\)]+?)\s+(?:vs\.?|v\.|against)\s+([A-Za-z0-9\s,\.\(\)]+?)(?:,|\.|\n|case)/i);
  // Extract Sale Date: e.g. "Sale Date: October 14, 2026" or "2026-10-14"
  const dateMatch = clean.match(/(?:sale\s+date|auction\s+date|to\s+be\s+sold\s+on)\s*(?:is|:)?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})/i);
  // Extract Labeled APN / Parcel ID: e.g. "APN: 123-45-678" or "Parcel ID: 010-234567"
  const apnMatch = clean.match(/\b(?:APN|Parcel\s*(?:ID|No\.?|Number|#)|Tax\s*(?:Map|Parcel|ID)|PIN)\s*[:#]\s*([0-9]{2,5}[-\s.][0-9A-Za-z]{2,6}(?:[-\s.][0-9A-Za-z]{1,8})+|\d{8,14})\b/i);
  // Extract Deposit Terms: e.g. "10% deposit required at sale" or "Deposit: $5,000 in certified funds"
  const depositMatch = clean.match(/(?:deposit\s*(?:terms|required)?[:\s]*)?(\d{1,2}\s?%|\btwenty\s+percent\b|\bten\s+percent\b|\$[0-9,]+)[^.]{0,80}?(?:deposit|down\s*payment|certified\s+funds)/i);

  const state = addressMatch ? addressMatch[3].toUpperCase() : 'OH';
  const judgmentNum = judgmentMatch ? parseFloat(judgmentMatch[1].replace(/,/g, '')) : 0;
  let bidNum = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, '')) : 0;
  // Guard against debt-as-price hallucination:
  // When an ambiguous parse equates bid with judgment debt without explicit bid phrasing, drop bid to 0.
  if (bidNum > 0 && judgmentNum > 0 && bidNum === judgmentNum && !clean.match(/(?:opening\s+bid|minimum\s+bid|upset\s+price|starting\s+bid)\s*(?:of|is|:)?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i)) {
    bidNum = 0;
  }

  const plaintiff = vsMatch ? vsMatch[1].trim() : '';
  const defendant = vsMatch ? vsMatch[2].trim() : '';
  const apn = apnMatch ? apnMatch[1].trim() : '';

  const seniorLienInfo = detectSeniorLienSurvival(plaintiff, clean);
  const redemptionInfo = getRedemptionRule(state);
  const statusInfo = detectBankruptcyOrAdjournment(clean);

  const rawText = String(rawNotice || '');
  const rawJudgmentSpanMatch = rawText.match(/(?:judgment(?:\s+amount)?|jdgmt|amount\s+due|debt)\s*(?:of|is|:)?\s*\$[0-9OoSs,]+(?:\.[0-9OoSs]{2})?/i);
  const rawBidSpanMatch = rawText.match(/(?:opening\s+bid|minimum\s+bid|upset\s+price|starting\s+bid)\s*(?:of|is|:)?\s*\$[0-9OoSs,]+(?:\.[0-9OoSs]{2})?/i);
  const rawDepositSpanMatch = rawText.match(/(?:deposit\s*(?:terms|required)?[:\s]*)?(\d{1,2}\s?%|\btwenty\s+percent\b|\bten\s+percent\b|\$[0-9OoSs,]+)[^.]{0,80}?(?:deposit|down\s*payment|certified\s+funds)/i);
  const verifySpanInRawOrClean = (candidate, rawFallbackMatch = null) => {
    if (!candidate) return null;
    const direct = verifyVerbatimSpan(rawText, candidate);
    if (direct && direct.verified) return direct;
    if (rawFallbackMatch) {
      const fallback = verifyVerbatimSpan(rawText, rawFallbackMatch[0].trim(), rawFallbackMatch.index);
      if (fallback && fallback.verified) return fallback;
    }
    return verifyVerbatimSpan(clean, candidate);
  };
  const rawEvidenceSpans = {
    property_address: addressMatch ? verifySpanInRawOrClean(addressMatch[1].trim()) : null,
    case_number: caseMatch ? verifySpanInRawOrClean(caseMatch[0].trim()) : null,
    judgment_amount: judgmentMatch ? verifySpanInRawOrClean(judgmentMatch[0].trim(), rawJudgmentSpanMatch) : null,
    opening_bid: bidMatch ? verifySpanInRawOrClean(bidMatch[0].trim(), rawBidSpanMatch) : null,
    plaintiff_or_seller: vsMatch ? verifySpanInRawOrClean(plaintiff) : null,
    defendant: vsMatch ? verifySpanInRawOrClean(defendant) : null,
    sale_date: dateMatch ? verifySpanInRawOrClean(dateMatch[0].trim()) : null,
    apn: apnMatch ? verifySpanInRawOrClean(apnMatch[0].trim()) : null,
    deposit_terms: depositMatch ? verifySpanInRawOrClean(depositMatch[0].trim(), rawDepositSpanMatch) : null,
  };
  const evidenceSpans = Object.fromEntries(
    Object.entries(rawEvidenceSpans).filter(([, span]) => span && span.verified)
  );
  const coreFound = [
    Boolean(evidenceSpans.property_address),
    Boolean(evidenceSpans.case_number),
    Boolean(evidenceSpans.judgment_amount || evidenceSpans.opening_bid),
    Boolean(evidenceSpans.plaintiff_or_seller),
    Boolean(evidenceSpans.sale_date),
  ].filter(Boolean).length;
  const confidenceScore = Math.round((coreFound / 5) * 100) / 100;

  return {
    property_address: addressMatch ? addressMatch[1].trim() : '',
    city: addressMatch ? addressMatch[2].trim() : '',
    state,
    zip: addressMatch && addressMatch[4] ? addressMatch[4] : '',
    case_number: caseMatch ? caseMatch[1].trim() : '',
    apn,
    plaintiff_or_seller: plaintiff,
    defendant,
    judgment_amount: judgmentNum,
    opening_bid: bidNum,
    deposit_terms: depositMatch ? depositMatch[0].trim() : '',
    sale_date: dateMatch ? dateMatch[1].trim() : '',
    senior_lien_risk: seniorLienInfo.riskLevel,
    senior_lien_warning: seniorLienInfo.warning,
    redemption_days: redemptionInfo.days,
    redemption_warning: redemptionInfo.warning,
    status: statusInfo.status,
    adjournment_date: statusInfo.adjournmentDate,
    confidence_score: confidenceScore,
    evidenceSpans,
    _strategy: 'deterministic_fallback'
  };
}

/**
 * High-level parser coordinating multi-parcel splitting, normalization, and fallback.
 * @param {string} rawNotice
 * @returns {Array<object>} Parsed parcel records
 */
function parseLegalNotice(rawNotice = '') {
  const parcels = splitMultiParcelNotice(rawNotice);
  return parcels.map(parcelText => deterministicParse(parcelText));
}

module.exports = {
  normalizeOcrText,
  neutralizePromptInjection,
  splitMultiParcelNotice,
  verifyVerbatimSpan,
  deterministicParse,
  parseLegalNotice
};
