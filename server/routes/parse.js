const SecuritySanitizer = require('../security/sanitizer');
const Validator = require('../security/validation');
const AiCache = require('../ai/cache');
const ModelRouter = require('../ai/model_router');
const { CostTracker } = require('../ai/cost_tracker');
const { deterministicParse, normalizeOcrText, neutralizePromptInjection } = require('../ai/notice-parser');
const { computeCashToClose } = require('../ai/legal-rules');

function calculateConfidence(parsed) {
  let score = 0;
  if (parsed.property_address && parsed.property_address.trim().length >= 8) score += 0.35;
  if (parsed.state && /^[A-Z]{2}$/.test(parsed.state.trim())) score += 0.15;
  if (parsed.case_number && parsed.case_number.trim().length >= 3) score += 0.20;
  if (parsed.opening_bid > 0 || parsed.judgment_amount > 0) score += 0.20;
  if (parsed.plaintiff_or_seller && parsed.plaintiff_or_seller.trim().length >= 3) score += 0.10;
  return Number(Math.min(1.0, score).toFixed(2));
}

async function callLlmExtraction(cleanNotice, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a real estate legal notice parser. Extract structured foreclosure auction details from the legal notice below.
Return ONLY a valid JSON object with these exact keys:
{
  "property_address": "Street address, City, State ZIP",
  "city": "City name",
  "state": "2-letter state code",
  "zip": "5-digit ZIP or empty",
  "case_number": "Court docket or case number",
  "plaintiff_or_seller": "Foreclosing lender, bank, or plaintiff",
  "defendant": "Borrower or defendant name",
  "judgment_amount": number or 0,
  "opening_bid": number or 0,
  "sale_date": "YYYY-MM-DD or date string"
}

Legal Notice:
"""
${cleanNotice}
"""`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const usage = data.usage || {};
    const parsedJson = JSON.parse(content);
    return {
      data: parsedJson,
      inputTokens: usage.prompt_tokens || Math.ceil(prompt.length / 4),
      outputTokens: usage.completion_tokens || Math.ceil((content?.length || 100) / 4)
    };
  } catch (_) {
    clearTimeout(timeout);
    return null;
  }
}

async function handleParse(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { noticeText, source: sourceHint, forceLlm } = req.body || {};
  const validation = Validator.validateNoticeInput(noticeText);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.error });
  }

  const cleanNotice = neutralizePromptInjection(SecuritySanitizer.sanitizePromptInput(noticeText));
  const model = ModelRouter.selectModel({ taskType: 'notice_parser', promptLength: cleanNotice.length });
  
  // Check AI cache first to avoid LLM / processing cost
  const cachedResponse = await AiCache.get(cleanNotice, model);
  if (cachedResponse) {
    try {
      return res.json({ parsed: JSON.parse(cachedResponse), cached: true, model });
    } catch (_) {}
  }

  // 1. Deterministic parse with OCR normalization, legal rules, and senior lien analysis
  let parsedData = deterministicParse(cleanNotice);
  let confidence = calculateConfidence(parsedData);
  let strategy = 'deterministic_regex';
  let cost = 0;

  // 2. Hybrid decision: if confidence is low (< 0.75) or forceLlm requested, invoke LLM if configured
  if ((confidence < 0.75 || forceLlm) && process.env.OPENAI_API_KEY) {
    const llmResult = await callLlmExtraction(cleanNotice, model);
    if (llmResult && llmResult.data) {
      strategy = 'llm_extracted';
      const ext = llmResult.data;
      parsedData = {
        ...parsedData,
        property_address: ext.property_address || parsedData.property_address,
        city: ext.city || parsedData.city,
        state: (ext.state || parsedData.state || 'OH').toUpperCase(),
        zip: ext.zip || parsedData.zip,
        case_number: ext.case_number || parsedData.case_number,
        plaintiff_or_seller: ext.plaintiff_or_seller || parsedData.plaintiff_or_seller,
        defendant: ext.defendant || parsedData.defendant,
        judgment_amount: Number(ext.judgment_amount) || parsedData.judgment_amount,
        opening_bid: Number(ext.opening_bid) || parsedData.opening_bid,
        sale_date: ext.sale_date || parsedData.sale_date,
        _strategy: 'llm_extracted'
      };
      confidence = calculateConfidence(parsedData);
      cost = CostTracker.calculateCost(model, llmResult.inputTokens, llmResult.outputTokens);
    }
  }

  // 3. Compute cash-to-close based on extracted figures
  const cashToClose = computeCashToClose({
    openingBid: parsedData.opening_bid || parsedData.judgment_amount || 50000,
    state: parsedData.state || 'OH',
    source: sourceHint || 'sheriff'
  });

  const structuredResult = {
    ...parsedData,
    confidence,
    sale_time: parsedData.sale_time || '10:00 AM',
    sale_type: parsedData.sale_type || 'Sheriff Sale',
    deposit_terms: parsedData.deposit_terms || '10% day of sale by certified funds',
    attorney: parsedData.attorney || 'Legal Counsel LLP',
    subject_to: parsedData.senior_lien_warning || 'Prior liens, unpaid taxes, and municipal assessments',
    redemption_note: parsedData.redemption_warning || 'Subject to statutory redemption rights under state law',
    cash_to_close: cashToClose
  };

  // 4. Cache structured response
  const inTokens = Math.ceil(cleanNotice.length / 4);
  const outTokens = 150;
  await AiCache.set(cleanNotice, model, JSON.stringify(structuredResult), inTokens, outTokens, cost, 'parser');

  return res.json({
    parsed: structuredResult,
    cached: false,
    confidence,
    strategy,
    model,
    costUsd: cost
  });
}

module.exports = handleParse;
