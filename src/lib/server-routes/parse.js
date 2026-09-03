const SecuritySanitizer = require('../security/sanitizer');
const Validator = require('../security/validation');
const AiCache = require('../ai/cache');
const ModelRouter = require('../ai/model_router');
const { CostTracker } = require('../ai/cost_tracker');
const { deterministicParse, normalizeOcrText, neutralizePromptInjection } = require('../ai/notice-parser');
const { computeCashToClose } = require('../ai/legal-rules');

async function handleParse(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { noticeText, source: sourceHint } = req.body || {};
  const validation = Validator.validateNoticeInput(noticeText);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.error });
  }

  const cleanNotice = neutralizePromptInjection(SecuritySanitizer.sanitizePromptInput(noticeText));
  const model = ModelRouter.selectModel({ taskType: 'notice_parser', promptLength: cleanNotice.length });
  
  // Check AI cache first to avoid LLM cost
  const cachedResponse = await AiCache.get(cleanNotice, model);
  if (cachedResponse) {
    try {
      return res.json({ parsed: JSON.parse(cachedResponse), cached: true, model });
    } catch (_) {}
  }

  // Resilient deterministic parse with OCR normalization, legal rules, and senior lien analysis
  const parsedData = deterministicParse(cleanNotice);

  // If opening bid or judgment is found, compute statutory cash-to-close
  const cashToClose = computeCashToClose({
    openingBid: parsedData.opening_bid || parsedData.judgment_amount || 50000,
    state: parsedData.state || 'OH',
    source: sourceHint || 'sheriff'
  });

  const structuredResult = {
    ...parsedData,
    sale_time: '10:00 AM',
    sale_type: 'Sheriff Sale',
    deposit_terms: parsedData.deposit_terms || '10% day of sale by certified funds',
    attorney: parsedData.attorney || 'Legal Counsel LLP',
    subject_to: parsedData.senior_lien_warning || 'Prior liens, unpaid taxes, and municipal assessments',
    redemption_note: parsedData.redemption_warning || 'Subject to statutory redemption rights under state law',
    cash_to_close: cashToClose
  };

  const cost = CostTracker.calculateCost(model, cleanNotice.length / 4, 150);
  await AiCache.set(cleanNotice, model, JSON.stringify(structuredResult), cleanNotice.length / 4, 150, cost, 'parser');

  return res.json({
    parsed: structuredResult,
    cached: false,
    model,
    costUsd: cost
  });
}

module.exports = handleParse;
