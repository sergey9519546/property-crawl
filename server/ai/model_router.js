class ModelRouter {
  static providerForModel(model = '') {
    const normalized = String(model || '').trim().toLowerCase();
    if (normalized.startsWith('gemini-')) return 'gemini';
    if (normalized.startsWith('gpt-')) return 'openai';
    return 'unknown';
  }

  static availableProviders(env = process.env) {
    const src = env || {};
    return {
      gemini: Boolean(src.GEMINI_API_KEY || src.GOOGLE_AI_API_KEY),
      openai: Boolean(src.OPENAI_API_KEY),
    };
  }

  static selectModel({
    taskType = 'notice_parser',
    promptLength = 0,
    isHighComplexity = false,
    env = process.env,
    preferredProvider = null,
  } = {}) {
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

    const providers = ModelRouter.availableProviders(env);
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
    const configured = provider === 'gemini'
      ? providers.gemini
      : (provider === 'openai' ? providers.openai : false);
    return { provider, model, configured };
  }
}

module.exports = ModelRouter;
