'use strict';

const SecuritySanitizer = require('../security/sanitizer');
const Validator = require('../security/validation');
const AiCache = require('../ai/cache');
const ModelRouter = require('../ai/model_router');
const { CostTracker } = require('../ai/cost_tracker');
const { normalizeOcrText, neutralizePromptInjection } = require('../ai/notice-parser');

const CACHE_VERSION = 'notice-evidence-v2';

function extractTextFromPdf(input) {
  if (typeof input !== 'string') return '';
  let str = input;
  if (str.startsWith('data:application/pdf;base64,')) {
    try {
      str = Buffer.from(str.slice('data:application/pdf;base64,'.length), 'base64').toString('latin1');
    } catch (_) {
      return '';
    }
  } else if (/^[A-Za-z0-9+/=]{100,}$/.test(str.trim())) {
    try {
      const decoded = Buffer.from(str.trim(), 'base64').toString('latin1');
      if (decoded.startsWith('%PDF')) str = decoded;
    } catch (_) {}
  }
  if (!str.includes('%PDF')) return input;

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let text = '';
  let match;
  while ((match = streamRegex.exec(str)) !== null) {
    const textMatches = match[1].match(/\(([^)]+)\)\s*Tj/g) || [];
    for (const textMatch of textMatches) {
      const inner = textMatch.match(/\(([^)]+)\)\s*Tj/);
      if (inner?.[1]) text += `${inner[1]} `;
    }
  }
  return text.trim() || str.replace(/[^\x20-\x7E\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function evidenceMatch(text, regex, valueGroup = 1) {
  const match = text.match(regex);
  if (!match) return { value: null, evidence: null };
  return {
    value: cleanString(match[valueGroup]),
    evidence: cleanString(match[0])
  };
}

function moneyMatch(text, regex, valueGroup = 1) {
  const match = text.match(regex);
  if (!match) return { value: null, evidence: null };
  return {
    value: money(match[valueGroup]),
    evidence: cleanString(match[0])
  };
}

function parseFraction(label) {
  if (!label) return null;
  const normalized = label.toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'two-thirds' || normalized === '2/3') return 2 / 3;
  if (normalized === 'one-half' || normalized === '1/2') return 1 / 2;
  if (normalized === 'three-fourths' || normalized === 'three-quarters' || normalized === '3/4') return 3 / 4;
  const numeric = normalized.match(/^(\d+)\/(\d+)$/);
  if (!numeric) return null;
  const numerator = Number(numeric[1]);
  const denominator = Number(numeric[2]);
  const fraction = denominator > 0 ? numerator / denominator : NaN;
  return Number.isFinite(fraction) && fraction > 0 && fraction <= 1 ? fraction : null;
}

function explicitStatutoryFraction(text) {
  const fractionToken = '(two[-\\s]thirds|one[-\\s]half|three[-\\s]fourths|three[-\\s]quarters|2\\s*\\/\\s*3|1\\s*\\/\\s*2|3\\s*\\/\\s*4)';
  const patterns = [
    new RegExp(`(?:minimum(?:\\s+opening)?\\s+bid|shall\\s+not\\s+be\\s+sold|cannot\\s+be\\s+sold|upset\\s+price)[^.\\n]{0,120}?${fractionToken}[^.\\n]{0,80}?(?:appraised|appraisal)`, 'i'),
    new RegExp(`(?:appraised|appraisal)[^.\\n]{0,100}?${fractionToken}[^.\\n]{0,80}?(?:minimum(?:\\s+opening)?\\s+bid|shall\\s+not\\s+be\\s+sold|upset\\s+price)`, 'i')
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseFraction(match[1].replace(/\s/g, ''));
    if (value !== null) return { value, label: cleanString(match[1]), evidence: cleanString(match[0]) };
  }
  return { value: null, label: null, evidence: null };
}

function extractObservedNotice(cleanNotice) {
  const fullAddress = evidenceMatch(
    cleanNotice,
    /\b(\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9.'#\-\s]{2,80}?,\s*([A-Za-z][A-Za-z.'\-\s]{1,50}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?))\b/i
  );
  const addressParts = fullAddress.evidence
    ? fullAddress.evidence.match(/,\s*([A-Za-z][A-Za-z.'\-\s]{1,50}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i)
    : null;
  const locality = addressParts || cleanNotice.match(/\b([A-Za-z][A-Za-z.'\-\s]{1,50}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  const county = evidenceMatch(cleanNotice, /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+County(?:\s+Court)?\b/i);
  const caseNumber = evidenceMatch(cleanNotice, /(?:case\s*(?:no\.?|#)|docket\s*(?:no\.?|#)?)\s*:?\s*([0-9A-Za-z\-\/]+)/i);
  const parties = cleanNotice.match(/([A-Za-z0-9][A-Za-z0-9\s,.&'()\-]{2,100}?)\s+(?:vs\.?|v\.?|against)\s+([A-Za-z0-9][A-Za-z0-9\s,.&'()\-]{2,100}?)(?:\.|\n|\s+Case\b)/i);
  const judgment = moneyMatch(cleanNotice, /(?:judgment(?:\s+amount)?|amount\s+due|debt)\s*(?:of|is|:)?\s*\$\s*([0-9,]+(?:\.\d{2})?)/i);
  const rawStatedBid = moneyMatch(
    cleanNotice,
    /(?:opening\s+bid|minimum(?:\s+opening)?\s+bid|upset\s+price|starting\s+bid)[^.\n$]{0,120}\$\s*([0-9,]+(?:\.\d{2})?)/i
  );
  const appraisal = moneyMatch(
    cleanNotice,
    /(?:appraised(?:\s+at)?|appraised\s+value(?:\s+of)?|appraisal(?:\s+amount)?)[^.\n$]{0,80}\$\s*([0-9,]+(?:\.\d{2})?)/i
  );
  const fraction = explicitStatutoryFraction(cleanNotice);
  // A phrase such as “minimum bid is 2/3 of appraised value of $150,000”
  // states the appraisal amount, not a $150,000 opening bid. Only promote the
  // currency as a stated bid when it is distinct from that appraisal evidence.
  const bidCurrencyIsFractionBase = rawStatedBid.value !== null
    && appraisal.value !== null
    && fraction.value !== null
    && rawStatedBid.value === appraisal.value
    && /apprais/i.test(rawStatedBid.evidence || '');
  const statedBid = bidCurrencyIsFractionBase
    ? { value: null, evidence: null }
    : rawStatedBid;
  const fractionBid = statedBid.value === null && appraisal.value !== null && fraction.value !== null
    ? Number((appraisal.value * fraction.value).toFixed(2))
    : null;
  const openingBid = statedBid.value ?? fractionBid;
  const saleDate = evidenceMatch(
    cleanNotice,
    /(?:sale\s+(?:date|will\s+be\s+held\s+on)|auction\s+date|to\s+be\s+sold\s+on|scheduled\s+for)\s*(?:is|:)?\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
    2
  );
  const saleTime = evidenceMatch(
    cleanNotice,
    /(?:sale|auction|held|scheduled)[^.\n]{0,140}?\b(?:at|time\s*:)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i
  );
  const saleType = evidenceMatch(
    cleanNotice,
    /\b((?:sheriff(?:'s)?|trustee(?:'s)?|foreclosure|tax)\s+sale|public\s+auction)\b/i
  );
  const deposit = evidenceMatch(
    cleanNotice,
    /\b(deposit(?:\s+of)?\s+(?:\$\s*[0-9,]+(?:\.\d{2})?|\d+(?:\.\d+)?\s*%)[^.\n]{0,100})/i
  );
  const attorney = evidenceMatch(
    cleanNotice,
    /(?:attorney(?:\s+of\s+record)?|counsel)\s*:?\s*([A-Z][A-Za-z0-9&',.\-\s]{2,100}?)(?=\.|\n|$)/i
  );
  const parcel = evidenceMatch(
    cleanNotice,
    /(?:permanent\s+)?parcel\s*(?:no\.?|id\.?|number)?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-./]{2,50})/i
  );

  const evidence = {
    property_address: fullAddress.evidence,
    city: fullAddress.evidence || (locality ? cleanString(locality[0]) : null),
    state: fullAddress.evidence || (locality ? cleanString(locality[0]) : null),
    zip: fullAddress.evidence || (locality ? cleanString(locality[0]) : null),
    county: county.evidence,
    case_number: caseNumber.evidence,
    plaintiff_or_seller: parties ? cleanString(parties[0]) : null,
    defendant: parties ? cleanString(parties[0]) : null,
    judgment_amount: judgment.evidence,
    appraised_value: appraisal.evidence,
    opening_bid: statedBid.evidence || (fractionBid !== null ? fraction.evidence : null),
    sale_date: saleDate.evidence,
    sale_time: saleTime.evidence,
    sale_type: saleType.evidence,
    deposit_terms: deposit.evidence,
    attorney: attorney.evidence,
    parcel_or_lot: parcel.evidence
  };

  const result = {
    property_address: fullAddress.value,
    city: locality ? cleanString(locality[1]) : null,
    state: locality ? cleanString(locality[2])?.toUpperCase() || null : null,
    zip: locality ? cleanString(locality[3]) : null,
    county: county.value,
    case_number: caseNumber.value,
    plaintiff_or_seller: parties ? cleanString(parties[1]) : null,
    defendant: parties ? cleanString(parties[2]) : null,
    judgment_amount: judgment.value,
    appraised_value: appraisal.value,
    opening_bid: openingBid,
    opening_bid_basis: statedBid.value !== null
      ? 'stated_in_notice'
      : fractionBid !== null
        ? 'derived_from_explicit_notice_fraction'
        : null,
    statutory_bid_fraction: fraction.value,
    statutory_bid_fraction_label: fraction.label,
    sale_date: saleDate.value,
    sale_time: saleTime.value,
    sale_type: saleType.value,
    deposit_terms: deposit.value,
    attorney: attorney.value,
    parcel_or_lot: parcel.value,
    estLow: null,
    estHigh: null,
    mid: null,
    equity: null,
    dealScore: null,
    cash_to_close: null,
    evidence,
    verification_status: 'unverified_extraction',
    raw_notice: cleanNotice
  };

  result.field_status = Object.fromEntries(
    Object.keys(evidence).map(field => [
      field,
      field === 'opening_bid' && fractionBid !== null
        ? 'derived_from_explicit_notice_fraction'
        : evidence[field]
          ? 'extracted_from_notice'
          : 'not_found'
    ])
  );
  return result;
}

function calculateConfidence(parsed) {
  const weighted = [
    ['property_address', 0.25],
    ['state', 0.1],
    ['case_number', 0.15],
    ['opening_bid', 0.15],
    ['sale_date', 0.15],
    ['plaintiff_or_seller', 0.1],
    ['defendant', 0.1]
  ];
  const score = weighted.reduce((sum, [field, weight]) => parsed[field] !== null ? sum + weight : sum, 0);
  return Number(Math.min(1, score).toFixed(2));
}

function sanitizeLlmCandidates(payload, cleanNotice) {
  const candidates = payload?.candidates;
  if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates)) return {};
  const allowed = new Set([
    'property_address', 'city', 'state', 'zip', 'county', 'case_number',
    'plaintiff_or_seller', 'defendant', 'judgment_amount', 'appraised_value',
    'opening_bid', 'sale_date', 'sale_time', 'sale_type', 'deposit_terms',
    'attorney', 'parcel_or_lot'
  ]);
  const normalizedNotice = cleanNotice.toLowerCase();
  const safe = {};
  for (const [field, candidate] of Object.entries(candidates)) {
    if (!allowed.has(field) || !candidate || typeof candidate !== 'object') continue;
    const evidence = cleanString(candidate.evidence);
    if (!evidence || evidence.length > 300 || !normalizedNotice.includes(evidence.toLowerCase())) continue;
    const isMoneyField = field === 'judgment_amount' || field === 'appraised_value' || field === 'opening_bid';
    const value = isMoneyField ? money(candidate.value) : cleanString(candidate.value);
    if (value === null) continue;
    if (isMoneyField) {
      const evidenceAmounts = evidence.match(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?/g) || [];
      if (!evidenceAmounts.some(amount => money(amount) === value)) continue;
    }
    safe[field] = { value, evidence, status: 'llm_candidate_unverified' };
  }
  return safe;
}

async function callLlmExtraction(cleanNotice, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Extract candidate fields from the legal notice. Do not infer, calculate, complete, or normalize missing facts. Every non-null candidate must include a short verbatim evidence excerpt found in the notice. Return only JSON in this shape: {"candidates":{"field":{"value":null,"evidence":null}}}. Candidate fields: property_address, city, state, zip, county, case_number, plaintiff_or_seller, defendant, judgment_amount, appraised_value, opening_bid, sale_date, sale_time, sale_type, deposit_terms, attorney, parcel_or_lot.\n\nNOTICE:\n${cleanNotice}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const responseBody = await response.json();
    const content = responseBody.choices?.[0]?.message?.content;
    if (!content) return null;
    return {
      data: JSON.parse(content),
      inputTokens: responseBody.usage?.prompt_tokens || Math.ceil(prompt.length / 4),
      outputTokens: responseBody.usage?.completion_tokens || Math.ceil(content.length / 4)
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleParse(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { noticeText, pdfBase64, forceLlm } = req.body || {};
  if (pdfBase64) {
    noticeText = extractTextFromPdf(pdfBase64);
  } else if (noticeText && (noticeText.startsWith('data:application/pdf') || noticeText.startsWith('%PDF'))) {
    noticeText = extractTextFromPdf(noticeText);
  }

  const validation = Validator.validateNoticeInput(noticeText);
  if (!validation.isValid) return res.status(400).json({ error: validation.error });

  const cleanNotice = normalizeOcrText(
    neutralizePromptInjection(SecuritySanitizer.sanitizePromptInput(noticeText))
  );
  const model = ModelRouter.selectModel({ taskType: 'notice_parser', promptLength: cleanNotice.length });
  const cacheKey = `${CACHE_VERSION}\n${cleanNotice}`;
  const cachedResponse = await AiCache.get(cacheKey, model);
  if (cachedResponse) {
    try {
      const cached = JSON.parse(cachedResponse);
      return res.json({ ...cached, cached: true });
    } catch (_) {}
  }

  const parsed = extractObservedNotice(cleanNotice);
  const confidence = calculateConfidence(parsed);
  let strategy = 'deterministic_evidence_extraction';
  let cost = 0;
  let unverifiedCandidates = {};

  if ((confidence < 0.75 || forceLlm === true) && process.env.OPENAI_API_KEY) {
    const llmResult = await callLlmExtraction(cleanNotice, model);
    if (llmResult?.data) {
      unverifiedCandidates = sanitizeLlmCandidates(llmResult.data, cleanNotice);
      if (Object.keys(unverifiedCandidates).length > 0) strategy = 'deterministic_with_unverified_llm_candidates';
      cost = CostTracker.calculateCost(model, llmResult.inputTokens, llmResult.outputTokens);
    }
  }

  const response = {
    parsed,
    cached: false,
    confidence,
    confidenceMeaning: 'Extraction completeness only; not factual verification.',
    strategy,
    model,
    costUsd: cost,
    unverifiedCandidates,
    reviewRequired: true
  };

  await AiCache.set(
    cacheKey,
    model,
    JSON.stringify(response),
    Math.ceil(cleanNotice.length / 4),
    Math.ceil(JSON.stringify(response).length / 4),
    cost,
    'notice_evidence_parser'
  );

  return res.json(response);
}

module.exports = handleParse;
module.exports.calculateConfidence = calculateConfidence;
module.exports.explicitStatutoryFraction = explicitStatutoryFraction;
module.exports.extractObservedNotice = extractObservedNotice;
module.exports.extractTextFromPdf = extractTextFromPdf;
module.exports.sanitizeLlmCandidates = sanitizeLlmCandidates;
