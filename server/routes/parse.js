'use strict';

const zlib = require('node:zlib');
const SecuritySanitizer = require('../security/sanitizer');
const Validator = require('../security/validation');
const AiCache = require('../ai/cache');
const ModelRouter = require('../ai/model_router');
const { CostRecord, CostTracker, recordSpendPg, isOverBudgetDurable } = require('../ai/cost_tracker');
let runtimeCostTracker = new CostTracker({ budgetLimitUsd: Number(process.env.AI_BUDGET_LIMIT_USD) || 5.00 });
const { normalizeOcrText, neutralizePromptInjection, parseLegalNoticeAsync } = require('../ai/notice-parser');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');

const CACHE_VERSION = 'notice-evidence-v2';
const MAX_PDF_INFLATE_BYTES = 2 * 1024 * 1024;

function unescapePdfLiteral(raw) {
  return String(raw || '')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\r?\n/g, '');
}

function readPdfLiteralAt(content, startIdx) {
  let depth = 1;
  let i = startIdx + 1;
  let raw = '';
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === '\\' && i + 1 < content.length) {
      raw += ch + content[i + 1];
      i += 2;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { text: unescapePdfLiteral(raw), nextIdx: i + 1 };
    }
    raw += ch;
    i += 1;
  }
  return null;
}

function skipWs(content, idx) {
  let i = idx;
  while (i < content.length && /\s/.test(content[i])) i += 1;
  return i;
}

function extractPdfOperatorsText(content) {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') {
      const lit = readPdfLiteralAt(content, i);
      if (lit) {
        const after = skipWs(content, lit.nextIdx);
        if (content.startsWith('Tj', after) && (after + 2 >= content.length || /[\s/<>\[\](]/.test(content[after + 2]))) {
          out += `${lit.text} `;
          i = after + 2;
          continue;
        }
        i = lit.nextIdx;
        continue;
      }
    } else if (ch === '[') {
      let j = i + 1;
      let arrayText = '';
      let closed = false;
      while (j < content.length) {
        if (content[j] === '(') {
          const lit = readPdfLiteralAt(content, j);
          if (lit) {
            arrayText += lit.text;
            j = lit.nextIdx;
            continue;
          }
        } else if (content[j] === ']') {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        const after = skipWs(content, j);
        if (content.startsWith('TJ', after) && (after + 2 >= content.length || /[\s/<>\[\](]/.test(content[after + 2]))) {
          if (arrayText) out += `${arrayText} `;
          i = after + 2;
          continue;
        }
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function tryDecompressPdfStream(streamBody) {
  const buf = Buffer.from(streamBody, 'latin1');
  try {
    return zlib.inflateSync(buf, { maxOutputLength: MAX_PDF_INFLATE_BYTES }).toString('latin1');
  } catch (_) {}
  try {
    return zlib.inflateRawSync(buf, { maxOutputLength: MAX_PDF_INFLATE_BYTES }).toString('latin1');
  } catch (_) {}
  return streamBody;
}

function extractTextFromPdf(input) {
  if (typeof input !== 'string') return '';
  let str = input;
  if (str.startsWith('data:application/pdf;base64,')) {
    try {
      str = Buffer.from(str.slice('data:application/pdf;base64,'.length), 'base64').toString('latin1');
    } catch (_) {
      return '';
    }
  } else if (/^[A-Za-z0-9+/=\s]{100,}$/.test(str.trim())) {
    try {
      const decoded = Buffer.from(str.replace(/\s+/g, ''), 'base64').toString('latin1');
      if (decoded.startsWith('%PDF')) str = decoded;
    } catch (_) {}
  }
  if (!str.includes('%PDF')) return input;

  const streamRegex = /stream(?:\r\n|\r|\n)([\s\S]*?)(?:\r\n|\r|\n)?endstream/g;
  let text = '';
  let match;
  while ((match = streamRegex.exec(str)) !== null) {
    const rawStream = match[1];
    const directText = extractPdfOperatorsText(rawStream);
    if (directText.trim()) {
      text += directText;
      continue;
    }
    const inflated = tryDecompressPdfStream(rawStream);
    if (inflated !== rawStream) {
      text += extractPdfOperatorsText(inflated);
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
  const fractionPattern = '(two[-\\s]thirds|one[-\\s]half|three[-\\s]fourths|three[-\\s]quarters|2\\s*\\/\\s*3|1\\s*\\/\\s*2|3\\s*\\/\\s*4)';
  const patterns = [
    new RegExp(`(?:minimum(?:\\s+opening)?\\s+bid|shall\\s+not\\s+be\\s+sold|cannot\\s+be\\s+sold|upset\\s+price)[^.\\n]{0,120}?${fractionPattern}[^.\\n]{0,80}?(?:appraised|appraisal)`, 'i'),
    new RegExp(`(?:appraised|appraisal)[^.\\n]{0,100}?${fractionPattern}[^.\\n]{0,80}?(?:minimum(?:\\s+opening)?\\s+bid|shall\\s+not\\s+be\\s+sold|upset\\s+price)`, 'i')
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
    // Accept "Deposit $X", "Deposit of $X", and the colon-prefixed forms
    // ("Deposit: $X", "Required deposit: $X") that appear in real notices.
    /\b(deposit(?:\s+of)?\s*:?\s+(?:\$\s*[0-9,]+(?:\.\d{2})?|\d+(?:\.\d+)?\s*%)[^.\n]{0,100})/i
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
  // Treat missing (undefined) the same as null — a fresh `{}` parsed
  // record must score 0, not 1 (the prior version's `!== null` check
  // passed for undefined fields, double-counting fields that never
  // existed in the notice).
  const score = weighted.reduce((sum, [field, weight]) => {
    const value = parsed?.[field];
    return value !== null && value !== undefined && value !== '' ? sum + weight : sum;
  }, 0);
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

function parseJsonContent(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) return null;
  return JSON.parse(cleaned);
}

async function callGeminiExtraction(prompt, model, apiKey, signal, fetchFn) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json'
      }
    }),
    signal
  });
  if (!response || !response.ok) return null;
  const responseBody = await response.json();
  const content = responseBody.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('') || '';
  const data = parseJsonContent(content);
  if (!data) return null;
  return {
    provider: 'gemini',
    model,
    data,
    inputTokens: responseBody.usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4),
    outputTokens: responseBody.usageMetadata?.candidatesTokenCount || Math.ceil(content.length / 4)
  };
}

async function callOpenAiExtraction(prompt, model, apiKey, signal, fetchFn) {
  const actualModel = model === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini';
  const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: actualModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' }
    }),
    signal
  });
  if (!response || !response.ok) return null;
  const responseBody = await response.json();
  const content = responseBody.choices?.[0]?.message?.content;
  const data = parseJsonContent(content);
  if (!data) return null;
  return {
    provider: 'openai',
    model: actualModel,
    data,
    inputTokens: responseBody.usage?.prompt_tokens || Math.ceil(prompt.length / 4),
    outputTokens: responseBody.usage?.completion_tokens || Math.ceil(content.length / 4)
  };
}

async function callVercelGatewayExtraction(prompt, gwModel, gatewayToken, signal, fetchFn, baseUrl) {
  const root = String(baseUrl || 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, '');
  const response = await fetchFn(`${root}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gatewayToken}`
    },
    body: JSON.stringify({
      model: gwModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' }
    }),
    signal
  });
  if (!response || !response.ok) return null;
  const responseBody = await response.json();
  const content = responseBody.choices?.[0]?.message?.content;
  let data = null;
  try {
    data = parseJsonContent(content);
  } catch (_) {
    return null;
  }
  if (!data) return null;
  return {
    provider: 'vercel_gateway',
    model: gwModel,
    data,
    inputTokens: responseBody.usage?.prompt_tokens || Math.ceil(prompt.length / 4),
    outputTokens: responseBody.usage?.completion_tokens || Math.ceil(String(content || '').length / 4)
  };
}

function buildExtractionPrompt(cleanNotice) {
  return `Extract candidate fields from the legal notice. Do not infer, calculate, complete, or normalize missing facts. Every non-null candidate must include a short verbatim evidence excerpt found in the notice. Return only JSON in this shape: {"candidates":{"field":{"value":null,"evidence":null}}}. Candidate fields: property_address, city, state, zip, county, case_number, plaintiff_or_seller, defendant, judgment_amount, appraised_value, opening_bid, sale_date, sale_time, sale_type, deposit_terms, attorney, parcel_or_lot.\n\nNOTICE:\n${cleanNotice}`;
}

async function callLlmWithRouting(promptOrOptions, modelArg, envArg = process.env, fetchFnArg = globalThis.fetch, signalArg = null) {
  const isOpts = Boolean(promptOrOptions && typeof promptOrOptions === 'object' && !Array.isArray(promptOrOptions));
  const model = isOpts ? promptOrOptions.model : modelArg;
  const env = (isOpts ? promptOrOptions.env : envArg) ?? process.env;
  const fetchFn = (isOpts ? promptOrOptions.fetchFn : fetchFnArg) ?? globalThis.fetch;
  const externalSignal = (isOpts ? promptOrOptions.signal : signalArg) || null;
  const oidcToken = isOpts ? (promptOrOptions.oidcToken || null) : null;
  const prompt = isOpts
    ? (promptOrOptions.prompt ?? (typeof promptOrOptions.cleanNotice === 'string' ? buildExtractionPrompt(promptOrOptions.cleanNotice) : ''))
    : promptOrOptions;

  if (typeof fetchFn !== 'function' || !prompt) return null;

  const gatewayToken = oidcToken || env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN || null;
  const geminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_AI_API_KEY || null;
  const openaiKey = env?.OPENAI_API_KEY || null;
  const desiredProvider = ModelRouter.providerForModel(model);
  const freeOnly = String(env?.AI_GATEWAY_FREE_ONLY || '').trim() === '1';
  const baseUrl = ModelRouter.gatewayBaseUrl(env);

  const pushGatewayAttempts = (targetAttempts) => {
    if (!gatewayToken) return;
    const baseChain = ModelRouter.gatewayModelChain(env);
    const chain = (model && desiredProvider === 'vercel_gateway')
      ? [model, ...baseChain.filter((m) => m !== model)]
      : baseChain;
    for (const gwModel of chain) {
      if (freeOnly && !ModelRouter.isFreeGatewayModel(gwModel, env)) continue;
      targetAttempts.push((sig) => callVercelGatewayExtraction(prompt, gwModel, gatewayToken, sig, fetchFn, baseUrl));
    }
  };

  const attempts = [];
  if (desiredProvider === 'gemini') {
    if (geminiKey) attempts.push((sig) => callGeminiExtraction(prompt, model || 'gemini-2.0-flash-lite', geminiKey, sig, fetchFn));
    if (openaiKey) attempts.push((sig) => callOpenAiExtraction(prompt, 'gpt-4o-mini', openaiKey, sig, fetchFn));
    pushGatewayAttempts(attempts);
  } else if (desiredProvider === 'openai') {
    if (openaiKey) attempts.push((sig) => callOpenAiExtraction(prompt, model || 'gpt-4o-mini', openaiKey, sig, fetchFn));
    if (geminiKey) attempts.push((sig) => callGeminiExtraction(prompt, 'gemini-2.0-flash-lite', geminiKey, sig, fetchFn));
    pushGatewayAttempts(attempts);
  } else {
    pushGatewayAttempts(attempts);
    if (openaiKey) attempts.push((sig) => callOpenAiExtraction(prompt, 'gpt-4o-mini', openaiKey, sig, fetchFn));
    if (geminiKey) attempts.push((sig) => callGeminiExtraction(prompt, 'gemini-2.0-flash-lite', geminiKey, sig, fetchFn));
  }

  for (const attempt of attempts) {
    if (externalSignal?.aborted) break;
    const controller = externalSignal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
    const activeSignal = externalSignal || controller.signal;
    try {
      const result = await attempt(activeSignal);
      if (result && result.data) {
        return result;
      }
    } catch (_) {
      // Primary provider failed at runtime; fall through to alternate provider if configured
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return null;
}

async function callLlmExtraction(cleanNotice, model, env = process.env, fetchFn = globalThis.fetch, oidcToken = null) {
  if (typeof fetchFn !== 'function') return null;
  const prompt = buildExtractionPrompt(cleanNotice);
  return callLlmWithRouting({ prompt, model, env, fetchFn, oidcToken });
}

async function handleParse(req, res, options = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const env = options?.env || process.env;
  const fetchFn = options?.fetchFn || globalThis.fetch;
  const cache = options?.cache || AiCache;
  if (!requireWorkspaceIdentity(req, res, env)) return;

  let { noticeText, pdfBase64, forceLlm, allowAiFallback } = req.body || {};
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
  const rawOidc = req.headers?.['x-vercel-oidc-token'];
  const oidcToken = Array.isArray(rawOidc)
    ? String(rawOidc[0] || '').trim() || null
    : (typeof rawOidc === 'string' && rawOidc.trim() ? rawOidc.trim() : null);
  const routerEnv = oidcToken && !env?.AI_GATEWAY_API_KEY && !env?.VERCEL_OIDC_TOKEN
    ? { ...(env || {}), VERCEL_OIDC_TOKEN: oidcToken }
    : env;

  const route = ModelRouter.selectRoute({
    taskType: 'notice_parser',
    promptLength: cleanNotice.length,
    isHighComplexity: cleanNotice.length > 4000,
    env: routerEnv
  });
  const requestedModel = route.model;
  let model = requestedModel;
  let provider = route.provider;
  const cacheKey = `${CACHE_VERSION}\n${allowAiFallback === true ? 'hybrid' : 'standard'}\n${cleanNotice}`;
  const cachedResponse = await cache.get(cacheKey, requestedModel);
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

  const spendDb = options?.db || require('../db/client');
  const spendPool = spendDb?.isPg && spendDb?.pool?.query ? spendDb.pool : null;
  let hybridParcels = null;
  if (allowAiFallback === true) {
    hybridParcels = await parseLegalNoticeAsync(cleanNotice, {
      ...(options?.parseOptions || {}),
      allowAiFallback: true,
      db: spendDb,
      env,
      fetchFn,
      oidcToken,
      llmExtractFn: options?.llmExtractFn,
    });
    if (Array.isArray(hybridParcels) && hybridParcels.some((p) => p?._strategy === 'hybrid_citation_locked')) {
      strategy = 'hybrid_citation_locked';
    }
  } else if ((confidence < 0.75 || forceLlm === true) && route.configured && !(await isOverBudgetDurable(spendPool, runtimeCostTracker))) {
    const llmResult = await callLlmExtraction(cleanNotice, requestedModel, env, fetchFn, oidcToken);
    if (llmResult?.data) {
      model = llmResult.model || model;
      provider = llmResult.provider || provider;
      unverifiedCandidates = sanitizeLlmCandidates(llmResult.data, cleanNotice);
      if (Object.keys(unverifiedCandidates).length > 0) strategy = 'deterministic_with_unverified_llm_candidates';
      cost = CostTracker.calculateCost(model, llmResult.inputTokens, llmResult.outputTokens);
      const costRecord = new CostRecord({
        provider,
        model,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        costUsd: cost
      });
      runtimeCostTracker = runtimeCostTracker.add(costRecord);
      await recordSpendPg(spendPool, costRecord, { route: 'parse' });
    }
  }

  const response = {
    parsed,
    cached: false,
    confidence,
    confidenceMeaning: 'Extraction completeness only; not factual verification.',
    strategy,
    provider,
    requestedModel,
    model,
    costUsd: cost,
    unverifiedCandidates,
    ...(hybridParcels ? { parcels: hybridParcels } : {}),
    reviewRequired: true
  };

  await cache.set(
    cacheKey,
    requestedModel,
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
module.exports.callLlmWithRouting = callLlmWithRouting;
module.exports.callLlmExtraction = callLlmExtraction;
module.exports.callVercelGatewayExtraction = callVercelGatewayExtraction;
module.exports.getCostTracker = () => runtimeCostTracker;
module.exports.resetCostTracker = (budgetLimitUsd = Number(process.env.AI_BUDGET_LIMIT_USD) || 5.00) => { runtimeCostTracker = new CostTracker({ budgetLimitUsd }); };
