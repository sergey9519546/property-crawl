const crypto = require('crypto');

class CostRecord {
  constructor({ model, inputTokens = 0, outputTokens = 0, costUsd = 0, timestamp = new Date() }) {
    this.model = model;
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
    this.costUsd = Number(costUsd);
    this.timestamp = timestamp;
    Object.freeze(this);
  }
}

// Pricing rates per 1M tokens in USD
const MODEL_RATES = {
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash':      { input: 0.10,  output: 0.40 },
  'gemini-2.5-flash':      { input: 0.15,  output: 0.60 },
  'gpt-4o-mini':           { input: 0.15,  output: 0.60 },
  'gpt-4o':                { input: 2.50,  output: 10.00 }
};

class CostTracker {
  constructor({ budgetLimitUsd = 5.00, records = [] } = {}) {
    this.budgetLimitUsd = budgetLimitUsd;
    this.records = Object.freeze([...records]);
    Object.freeze(this);
  }

  static calculateCost(model, inputTokens, outputTokens) {
    const rate = MODEL_RATES[model] || MODEL_RATES['gpt-4o-mini'];
    const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
    return Number(cost.toFixed(6));
  }

  add(record) {
    return new CostTracker({
      budgetLimitUsd: this.budgetLimitUsd,
      records: [...this.records, record]
    });
  }

  get totalCost() {
    return Number(this.records.reduce((sum, r) => sum + r.costUsd, 0).toFixed(6));
  }

  get totalInputTokens() {
    return this.records.reduce((sum, r) => sum + r.inputTokens, 0);
  }

  get totalOutputTokens() {
    return this.records.reduce((sum, r) => sum + r.outputTokens, 0);
  }

  get isOverBudget() {
    return this.totalCost >= this.budgetLimitUsd;
  }
}

module.exports = { CostRecord, CostTracker, MODEL_RATES };
