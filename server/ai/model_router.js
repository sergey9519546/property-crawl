const { MODEL_RATES } = require('./cost_tracker');

const DEFAULT_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

const FREE_GATEWAY_MODELS = Object.freeze([
  'nvidia/nemotron-3.5-lightning-free',
  'reflection/beam-free',
]);

const PAID_GATEWAY_FALLBACK_MODELS = Object.freeze([
  'alibaba/qwen3.7-flash',
  'google/gemini-2.5-flash-lite',
  'openai/gpt-5-nano',
]);

class ModelRouter {
  static providerForModel(model = '') {
    const normalized = String(model || '').trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (normalized.includes('/')) return 'vercel_gateway';
    if (normalized.startsWith('gemini-')) return 'gemini';
    if (normalized.startsWith('gpt-')) return 'openai';
    return 'unknown';
  }

  static availableProviders(env = process.env) {
    const src = env || {};
    return {
      vercel_gateway: Boolean(src.AI_GATEWAY_API_KEY || src.VERCEL_OIDC_TOKEN),
      gemini: Boolean(src.GEMINI_API_KEY || src.GOOGLE_AI_API_KEY),
      openai: Boolean(src.OPENAI_API_KEY),
    };
  }

  static gatewayModelChain(env = process.env) {
    const src = env || {};
    const custom = String(src.AI_GATEWAY_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (custom.length > 0) return custom;
    const freeOnly = String(src.AI_GATEWAY_FREE_ONLY || '').trim() === '1';
    return freeOnly
      ? [...FREE_GATEWAY_MODELS]
      : [...FREE_GATEWAY_MODELS, ...PAID_GATEWAY_FALLBACK_MODELS];
  }

  static isFreeGatewayModel(model, _env = process.env) {
    const normalized = String(model || '').trim().toLowerCase();
    if (!normalized) return false;
    if (FREE_GATEWAY_MODELS.includes(normalized)) return true;
    const rate = Object.prototype.hasOwnProperty.call(MODEL_RATES, normalized)
      ? MODEL_RATES[normalized]
      : null;
    if (rate && rate.input === 0 && rate.output === 0) return true;
    if (normalized.endsWith('-free') || normalized.endsWith(':free') || normalized === 'free') return true;
    return false;
  }

  static gatewayBaseUrl(env = process.env) {
    const raw = String(env?.AI_GATEWAY_BASE_URL || '').trim();
    if (!raw || raw.includes('*')) return DEFAULT_GATEWAY_BASE_URL;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return DEFAULT_GATEWAY_BASE_URL;
      if (parsed.username || parsed.password) return DEFAULT_GATEWAY_BASE_URL;
      if (!parsed.hostname || parsed.hostname.includes('*')) return DEFAULT_GATEWAY_BASE_URL;
      return parsed.toString().replace(/\/+$/, '');
    } catch (_) {
      return DEFAULT_GATEWAY_BASE_URL;
    }
  }

  static selectModel({
    taskType = 'notice_parser',
    promptLength = 0,
    isHighComplexity = false,
    env = process.env,
    preferredProvider = null,
  } = {}) {
    const providers = ModelRouter.availableProviders(env);
    if (providers.vercel_gateway && (!preferredProvider || preferredProvider === 'vercel_gateway')) {
      return ModelRouter.gatewayModelChain(env)[0] || FREE_GATEWAY_MODELS[0];
    }

    let model;

    // 1. Notice parsing: structured JSON extraction works efficiently on high-speed flash
    if (taskType === 'notice_parser') {
      model = (promptLength > 4000 || isHighComplexity)
        ? 'gemini-2.0-flash'
        : 'gemini-2.0-flash-lite';
    } else if (taskType === 'deal_analysis') {
      // 2. Risk analysis / 'Here's the catch' synthesis: requires nuanced reasoning
      model = 'gpt-4o-mini';
    } else if (taskType === 'comp_valuation') {
      // 3. Multi-source comps valuation
      model = isHighComplexity ? 'gpt-4o' : 'gpt-4o-mini';
    } else {
      model = 'gemini-2.0-flash';
    }

    const desired = preferredProvider || ModelRouter.providerForModel(model);

    if (desired === 'gemini' && !providers.gemini && providers.openai) {
      return isHighComplexity ? 'gpt-4o' : 'gpt-4o-mini';
    }
    if (desired === 'openai' && !providers.openai && providers.gemini) {
      return isHighComplexity ? 'gemini-2.0-flash' : 'gemini-2.0-flash-lite';
    }

    return model;
  }

  static selectRoute(options = {}) {
    const model = ModelRouter.selectModel(options);
    const provider = ModelRouter.providerForModel(model);
    const providers = ModelRouter.availableProviders(options.env);
    const configured = provider === 'vercel_gateway'
      ? providers.vercel_gateway
      : (provider === 'gemini'
          ? providers.gemini
          : (provider === 'openai' ? providers.openai : false));
    return { provider, model, configured };
  }
}

ModelRouter.FREE_GATEWAY_MODELS = FREE_GATEWAY_MODELS;
ModelRouter.PAID_GATEWAY_FALLBACK_MODELS = PAID_GATEWAY_FALLBACK_MODELS;

module.exports = ModelRouter;
