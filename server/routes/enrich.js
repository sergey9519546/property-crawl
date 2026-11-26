const crypto = require('crypto');
const db = require('../db/client');
const SecuritySanitizer = require('../security/sanitizer');
const ModelRouter = require('../ai/model_router');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { CostRecord, CostTracker, recordSpendPg, isOverBudgetDurable } = require('../ai/cost_tracker');

let runtimeCostTracker = new CostTracker({ budgetLimitUsd: Number(process.env.AI_BUDGET_LIMIT_USD) || 5.0 });

const SUMMARY_MODEL = 'evidence-summary-v1';

function hasValue(value) {
  return value !== null && value !== undefined
    && (typeof value !== 'string' || value.trim() !== '');
}

function safeText(value) {
  return SecuritySanitizer.escapeHtml(String(value).replace(/\s+/g, ' ').trim());
}

function amount(value) {
  if (!hasValue(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return `$${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function addObserved(lines, label, value) {
  if (hasValue(value)) lines.push(`- ${label}: **${safeText(value)}**`);
}

function buildEvidenceSummary(listing) {
  const observed = [];
  const gaps = [];
  const provenance = listing.provenance && typeof listing.provenance === 'object'
    ? listing.provenance
    : {};

  addObserved(observed, 'Address', listing.address);
  addObserved(observed, 'Source', listing.source);
  addObserved(observed, 'Source record URL', listing.sourceUrl);

  const openingBid = amount(listing.openingBid);
  if (openingBid) addObserved(observed, 'Opening-bid field', openingBid);
  else gaps.push('Opening bid: not present in the listing record; obtain the current published amount before underwriting.');

  const estLow = amount(listing.estLow);
  const estHigh = amount(listing.estHigh);
  if (estLow && estHigh) addObserved(observed, 'Valuation-range fields', `${estLow}–${estHigh}`);
  else gaps.push('Valuation evidence: a complete estimate range is not present; obtain independent comparable-sales or appraisal support.');

  const assessed = amount(listing.assessed);
  if (assessed) addObserved(observed, 'Assessed-value field', assessed);
  addObserved(observed, 'Sale date field', listing.saleDate);
  addObserved(observed, 'Occupancy field', listing.occupancy);
  addObserved(observed, 'Deposit-terms field', listing.deposit);
  addObserved(observed, 'Plaintiff field', listing.plaintiff);
  addObserved(observed, 'Defendant field', listing.defendant);
  const judgment = amount(listing.judgment);
  if (judgment) addObserved(observed, 'Judgment-amount field', judgment);
  addObserved(observed, 'Status field', listing.status);
  addObserved(observed, 'Source-observed timestamp', listing.sourceObservedAt);
  addObserved(observed, 'Fetched timestamp', listing.fetchedAt);

  addObserved(observed, 'Source property ID', provenance.propertyId);
  addObserved(observed, 'Source sheriff number', provenance.sheriffNumber);
  addObserved(observed, 'Source-reported court case number', provenance.courtCaseNumber);
  addObserved(observed, 'Source parcel number', provenance.parcelNumber);
  addObserved(observed, 'Opening-bid source', provenance.openingBidSource);

  if (!hasValue(listing.sourceUrl)) {
    gaps.push('Exact source record: no direct record URL is attached; locate the publisher record before relying on any field.');
  }
  if (!hasValue(listing.saleDate)) {
    gaps.push('Sale schedule: not present; confirm status, date, time, postponements, and cancellation directly with the publisher.');
  }
  if (!hasValue(listing.deposit)) {
    gaps.push('Deposit and payment terms: not present; verify amount, form of funds, deadline, premiums, and fees.');
  }
  if (!hasValue(listing.occupancy)) {
    gaps.push('Occupancy and access: not present; do not infer vacancy, possession, or inspection rights.');
  }

  gaps.push('Court evidence: no official docket response is attached; verify the case, parties, sale order, and current status.');
  gaps.push('Title evidence: no recorder search or title commitment is attached; verify ownership, lien priority, surviving interests, and deed type.');
  gaps.push('Tax and municipal evidence: no current official balances are attached; verify taxes, assessments, utilities, and code obligations.');
  gaps.push('Condition evidence: interior condition and material property defects are not verified by this summary.');

  return `**Evidence summary — unverified**

**Observed listing fields**
${observed.join('\n')}

**Unknown or verification required**
${gaps.map((gap) => `- ${gap}`).join('\n')}

This deterministic summary reports stored fields only. It is not a title search, legal opinion, appraisal, condition report, or bid recommendation.`;
}

function buildBriefingPrompt(deterministicSummary) {
  return [
    'Write a concise operator briefing summarizing ONLY the observed facts and explicitly stating all verification-required gaps below.',
    'Zero-Fabrication Rule: Never invent ARV, repair cost, title status, lien clearance, occupancy, or bidding advice not present in the evidence summary.',
    '',
    deterministicSummary,
  ].join('\n');
}

function extractDollarAmounts(text) {
  const matches = String(text || '').match(/\$[0-9,]+(?:\.[0-9]+)?/g) || [];
  const values = new Set();
  for (const token of matches) {
    const num = Number(token.replace(/[$,]/g, ''));
    if (Number.isFinite(num)) values.add(num);
  }
  return values;
}

function validateGroundedNarrative(narrative, deterministicSummary) {
  if (typeof narrative !== 'string') {
    return { ok: false, reason: 'invalid_narrative' };
  }
  const trimmed = narrative.trim();
  if (!trimmed || trimmed.length > 4000) {
    return { ok: false, reason: 'invalid_narrative_length' };
  }

  const allowedDollars = extractDollarAmounts(deterministicSummary);
  const narrativeDollars = trimmed.match(/\$[0-9,]+(?:\.[0-9]+)?/g) || [];
  for (const token of narrativeDollars) {
    const num = Number(token.replace(/[$,]/g, ''));
    if (!Number.isFinite(num) || !allowedDollars.has(num)) {
      return { ok: false, reason: 'ungrounded_dollar_figure' };
    }
  }

  const summaryText = String(deterministicSummary || '');
  const prohibited = [
    /\bclear\s+title\b/i,
    /\bguaranteed\s+equity\b/i,
    /\bfree\s+and\s+clear\b/i,
  ];
  for (const pattern of prohibited) {
    if (pattern.test(trimmed) && !pattern.test(summaryText)) {
      return { ok: false, reason: 'prohibited_assurance_phrase' };
    }
  }

  return { ok: true };
}

async function persistAiBriefCache({ dbClient = db, model, prompt, narrative, inputTokens = 0, outputTokens = 0, costUsd = 0 }) {
  if (!dbClient || typeof dbClient.setAiCache !== 'function' || !narrative || !model || !prompt) {
    return false;
  }
  try {
    const contentHash = crypto.createHash('sha256').update(`${model}:${prompt.trim()}`).digest('hex');
    await dbClient.setAiCache({
      contentHash,
      promptType: 'evidence-brief',
      model,
      inputTokens,
      outputTokens,
      costUsd,
      responseText: narrative,
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function generateAiNarrative(listing, options = {}) {
  const env = options.env || process.env;
  const fetchFn = options.fetchFn || globalThis.fetch;
  const targetDb = options.db || db;
  const deterministicSummary = buildEvidenceSummary(listing);
  const gatewayToken = options.oidcToken || env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN || null;
  const geminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_AI_API_KEY || null;
  const openaiKey = env?.OPENAI_API_KEY || null;

  if (typeof fetchFn !== 'function' || (!gatewayToken && !geminiKey && !openaiKey)) {
    return {
      narrative: null,
      provider: null,
      model: null,
      costUsd: 0,
      cached: false,
      fallback: true,
      reason: typeof fetchFn !== 'function' ? 'fetch_unavailable' : 'api_key_missing',
    };
  }

  const prompt = buildBriefingPrompt(deterministicSummary);
  const requestedModel = options.model || (openaiKey ? 'gpt-4o-mini' : 'gemini-2.0-flash-lite');
  const preferredProvider = options.model ? ModelRouter.providerForModel(options.model) : null;
  const explicitLegacyOverride = Boolean(
    options.model
    && ((preferredProvider === 'openai' && openaiKey) || (preferredProvider === 'gemini' && geminiKey))
  );

  let failureReason = 'llm_unavailable';

  if (gatewayToken && !explicitLegacyOverride) {
    const baseUrl = ModelRouter.gatewayBaseUrl(env);
    const freeOnly = String(env?.AI_GATEWAY_FREE_ONLY || '').trim() === '1';
    const baseChain = ModelRouter.gatewayModelChain(env);
    const chain = (options.model && ModelRouter.providerForModel(options.model) === 'vercel_gateway')
      ? [options.model, ...baseChain.filter((m) => m !== options.model)]
      : baseChain;

    for (const gwModel of chain) {
      if (!ModelRouter.isFreeGatewayModel(gwModel, env) && (freeOnly || options.costTracker?.isOverBudget)) {
        continue;
      }
      try {
        const resp = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gatewayToken}`,
          },
          body: JSON.stringify({
            model: gwModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
          }),
          signal: options.signal || AbortSignal.timeout(8000),
        });
        if (!resp || !resp.ok) continue;
        const body = await resp.json();
        const text = body?.choices?.[0]?.message?.content?.trim();
        if (!text) continue;

        const grounded = validateGroundedNarrative(text, deterministicSummary);
        if (!grounded.ok) {
          failureReason = 'ungrounded_claim';
          continue;
        }

        const inTok = body?.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
        const outTok = body?.usage?.completion_tokens || Math.ceil(text.length / 4);
        const costUsd = CostTracker.calculateCost(gwModel, inTok, outTok);

        if (options.persistCache) {
          await persistAiBriefCache({
            dbClient: targetDb,
            model: gwModel,
            prompt,
            narrative: text,
            inputTokens: inTok,
            outputTokens: outTok,
            costUsd,
          });
        }

        return {
          narrative: text,
          provider: 'vercel_gateway',
          model: gwModel,
          costUsd,
          inputTokens: inTok,
          outputTokens: outTok,
          cached: false,
          fallback: false,
          reason: null,
        };
      } catch (_) {
        // Gateway model failed; try next model in chain or direct fallback
      }
    }
  }

  const callOpenAi = async () => {
    if (!openaiKey) return null;
    const actualModel = requestedModel.startsWith('gpt-') ? requestedModel : 'gpt-4o-mini';
    const resp = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: actualModel, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
      signal: options.signal || AbortSignal.timeout(8000),
    });
    if (!resp || !resp.ok) return null;
    const body = await resp.json();
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    const inTok = body?.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
    const outTok = body?.usage?.completion_tokens || Math.ceil(text.length / 4);
    return {
      narrative: text,
      provider: 'openai',
      model: actualModel,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: CostTracker.calculateCost(actualModel, inTok, outTok),
    };
  };

  const callGemini = async () => {
    if (!geminiKey) return null;
    const actualModel = requestedModel.startsWith('gemini') ? requestedModel : 'gemini-2.0-flash-lite';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(actualModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const resp = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: options.signal || AbortSignal.timeout(8000),
    });
    if (!resp || !resp.ok) return null;
    const body = await resp.json();
    const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return null;
    return {
      narrative: text,
      provider: 'gemini',
      model: actualModel,
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      costUsd: 0,
    };
  };

  const attempts = preferredProvider === 'gemini' ? [callGemini, callOpenAi] : [callOpenAi, callGemini];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (res && res.narrative) {
        const grounded = validateGroundedNarrative(res.narrative, deterministicSummary);
        if (!grounded.ok) {
          failureReason = 'ungrounded_claim';
          continue;
        }
        if (options.persistCache) {
          await persistAiBriefCache({
            dbClient: targetDb,
            model: res.model,
            prompt,
            narrative: res.narrative,
            inputTokens: res.inputTokens || 0,
            outputTokens: res.outputTokens || 0,
            costUsd: Number(res.costUsd) || 0,
          });
        }
        return { ...res, cached: false, fallback: false, reason: null };
      }
    } catch (_) {
      // Primary provider failed; fall through to alternate provider or deterministic summary
    }
  }

  return {
    narrative: null,
    provider: null,
    model: null,
    costUsd: 0,
    cached: false,
    fallback: true,
    reason: failureReason,
  };
}

async function readCachedNarrative(analysis, options = {}) {
  const targetDb = options.db || db;
  const env = options.env || process.env;
  if (!targetDb || typeof targetDb.getAiCache !== 'function') return { narrative: null, model: null };
  const prompt = buildBriefingPrompt(analysis);
  const modelsToCheck = Array.from(new Set([
    ...ModelRouter.gatewayModelChain(env),
    ...ModelRouter.FREE_GATEWAY_MODELS,
    ...ModelRouter.PAID_GATEWAY_FALLBACK_MODELS,
    'gemini-2.0-flash-lite',
    'gpt-4o-mini',
    SUMMARY_MODEL,
  ]));
  for (const model of modelsToCheck) {
    try {
      const hash = crypto.createHash('sha256').update(`${model}:${prompt.trim()}`).digest('hex');
      const row = await targetDb.getAiCache(hash);
      const narrative = row?.response_text || row?.responseText || null;
      if (narrative) return { narrative, model: row?.model_used || row?.model || model };
    } catch (_) {
      // Cache lookup errors are non-fatal; return deterministic summary only.
    }
  }
  return { narrative: null, model: null };
}

async function handleCachedEnrichGet(req, res, deps = {}) {
  const targetDb = deps.db || db;
  let listingId = req.query?.listingId || '';
  if (!listingId && req.url) {
    try {
      listingId = new URL(req.url, 'http://localhost').searchParams.get('listingId') || '';
    } catch (_) {
      listingId = '';
    }
  }
  if (!String(listingId).trim()) {
    return res.status(400).json({ error: 'listingId is required' });
  }
  const listing = await targetDb.getListingById(String(listingId).trim());
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  const analysis = buildEvidenceSummary(listing);
  const cached = await readCachedNarrative(analysis, { db: targetDb, env: deps.env || process.env });
  const fallbackPrewarmed = listing.provenance?.aiCatch?.narrative || null;
  const aiNarrative = cached.narrative || fallbackPrewarmed;
  return res.json({
    analysis,
    catchSummary: listing.catchSummary || null,
    aiNarrative,
    cached: Boolean(aiNarrative),
    model: cached.model || (fallbackPrewarmed ? (listing.provenance?.aiCatch?.model || SUMMARY_MODEL) : SUMMARY_MODEL),
    costUsd: 0,
    verified: false,
  });
}

async function handleEnrich(req, res, deps = {}) {
  if (req.method === 'GET') {
    return handleCachedEnrichGet(req, res, deps);
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const targetDb = deps.db || db;
  const { listingId, includeAiNarrative, useAi, model } = req.body || {};
  if (!listingId) {
    return res.status(400).json({ error: 'listingId is required' });
  }

  const listing = await targetDb.getListingById(listingId);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }

  const analysis = buildEvidenceSummary(listing);
  const wantsAi = Boolean(includeAiNarrative || useAi);
  if (!wantsAi) {
    return res.json({
      analysis,
      cached: false,
      model: SUMMARY_MODEL,
      costUsd: 0,
      verified: false,
    });
  }

  const env = deps.env || process.env;
  const identity = requireWorkspaceIdentity(req, res, env);
  if (!identity) return;

  const activeTracker = deps.costTracker || runtimeCostTracker;
  const spendPool = targetDb?.isPg && targetDb?.pool?.query ? targetDb.pool : null;
  if (activeTracker && (await isOverBudgetDurable(spendPool, activeTracker))) {
    return res.status(429).json({
      error: 'AI narrative budget exceeded',
      analysis,
      aiNarrative: null,
      narrativeFallback: true,
      narrativeReason: 'budget_exceeded',
      costUsd: 0,
      verified: false,
    });
  }

  const rawOidc = req.headers?.['x-vercel-oidc-token'];
  const oidcToken = Array.isArray(rawOidc)
    ? String(rawOidc[0] || '').trim() || null
    : (typeof rawOidc === 'string' && rawOidc.trim() ? rawOidc.trim() : null);

  const ai = await generateAiNarrative(listing, {
    env,
    db: targetDb,
    fetchFn: deps.fetchFn || globalThis.fetch,
    model: model || null,
    oidcToken,
    costTracker: activeTracker,
    persistCache: true,
  });
  if (
    activeTracker
    && typeof activeTracker.add === 'function'
    && ai?.narrative
    && !ai?.cached
    && (Number(ai?.costUsd) > 0 || Number(ai?.inputTokens) > 0 || Number(ai?.outputTokens) > 0)
  ) {
    const spendRecord = new CostRecord({
      provider: ai.provider || 'vercel_gateway',
      model: ai.model || SUMMARY_MODEL,
      inputTokens: Number(ai.inputTokens) || 0,
      outputTokens: Number(ai.outputTokens) || 0,
      costUsd: Number(ai.costUsd) || 0,
    });
    const updatedTracker = activeTracker.add(spendRecord);
    if (!deps.costTracker) runtimeCostTracker = updatedTracker;
    await recordSpendPg(spendPool, spendRecord, { route: 'enrich' });
  }

  return res.json({
    analysis,
    aiNarrative: ai.narrative,
    narrativeModel: ai.model || SUMMARY_MODEL,
    narrativeProvider: ai.provider,
    narrativeFallback: ai.fallback,
    narrativeReason: ai.reason,
    cached: ai.cached,
    model: SUMMARY_MODEL,
    costUsd: ai.costUsd,
    verified: false,
  });
}

module.exports = handleEnrich;
module.exports.buildEvidenceSummary = buildEvidenceSummary;
module.exports.SUMMARY_MODEL = SUMMARY_MODEL;
module.exports.generateAiNarrative = generateAiNarrative;
module.exports.validateGroundedNarrative = validateGroundedNarrative;
module.exports.readCachedNarrative = readCachedNarrative;
