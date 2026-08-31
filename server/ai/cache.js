const crypto = require('crypto');
const db = require('../db/client');

class AiCache {
  static hashPrompt(prompt, model = '') {
    return crypto.createHash('sha256').update(`${model}:${prompt.trim()}`).digest('hex');
  }

  static async get(prompt, model) {
    const hash = this.hashPrompt(prompt, model);
    const cached = await db.getAiCache(hash);
    return cached ? cached.response_text || cached.responseText : null;
  }

  static async set(prompt, model, responseText, inputTokens = 0, outputTokens = 0, costUsd = 0, promptType = 'general') {
    const hash = this.hashPrompt(prompt, model);
    await db.setAiCache({
      contentHash: hash,
      promptType,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      responseText
    });
  }
}

module.exports = AiCache;
