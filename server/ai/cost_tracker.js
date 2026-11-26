const crypto = require('crypto');

class CostRecord {
  constructor({ provider = 'unknown', model, inputTokens = 0, outputTokens = 0, costUsd = 0, timestamp = new Date() }) {
    this.provider = provider;
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
  'nvidia/nemotron-3.5-lightning-free': { input: 0,     output: 0 },
  'reflection/beam-free':               { input: 0,     output: 0 },
  'alibaba/qwen3.7-flash':              { input: 0.03,  output: 0.13 },
  'google/gemini-2.5-flash-lite':       { input: 0.10,  output: 0.40 },
  'openai/gpt-5-nano':                  { input: 0.05,  output: 0.40 },
  'openai/gpt-4o-mini':                 { input: 0.15,  output: 0.60 },
  'openai/gpt-4o':                      { input: 2.50,  output: 10.00 },
  'gemini-2.0-flash-lite':              { input: 0.075, output: 0.30 },
  'gemini-2.0-flash':                   { input: 0.10,  output: 0.40 },
  'gemini-2.5-flash':                   { input: 0.15,  output: 0.60 },
  'gpt-4o-mini':                        { input: 0.15,  output: 0.60 },
  'gpt-4o':                             { input: 2.50,  output: 10.00 }
};

class CostTracker {
  constructor({ budgetLimitUsd = 5.00, records = [] } = {}) {
    this.budgetLimitUsd = budgetLimitUsd;
    this.records = Object.freeze([...records]);
    Object.freeze(this);
  }

  static calculateCost(model, inputTokens, outputTokens) {
    const rate = Object.prototype.hasOwnProperty.call(MODEL_RATES, model)
      ? MODEL_RATES[model]
      : MODEL_RATES['gpt-4o-mini'];
    if (rate.input === 0 && rate.output === 0) return 0;
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

async function recordSpendPg(pool, record, { route = null } = {}) {
  if (!pool || typeof pool.query !== 'function' || !record) return false;
  try {
    await pool.query(
      `INSERT INTO ai_spend_ledger (provider, model, route, input_tokens, output_tokens, cost_usd, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        String(record.provider || 'unknown').slice(0, 64),
        String(record.model || 'unknown').slice(0, 128),
        route ? String(route).slice(0, 64) : null,
        Math.max(0, Math.trunc(Number(record.inputTokens) || 0)),
        Math.max(0, Math.trunc(Number(record.outputTokens) || 0)),
        Number(record.costUsd) || 0,
        record.timestamp instanceof Date ? record.timestamp.toISOString() : new Date().toISOString(),
      ],
    );
    return true;
  } catch {
    return false;
  }
}

async function getRollingSpendUsdPg(pool, { windowHours = 24 } = {}) {
  if (!pool || typeof pool.query !== 'function') return 0;
  const hours = Math.max(1, Math.trunc(Number(windowHours) || 24));
  try {
    const res = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total_usd
         FROM ai_spend_ledger
        WHERE recorded_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
      [hours],
    );
    return Number(res.rows?.[0]?.total_usd) || 0;
  } catch {
    return 0;
  }
}

async function isOverBudgetDurable(pool, tracker, { windowHours = 24 } = {}) {
  if (tracker?.isOverBudget) return true;
  const limit = Number(tracker?.budgetLimitUsd);
  if (!pool || !Number.isFinite(limit) || limit <= 0) return false;
  const rollingSpend = await getRollingSpendUsdPg(pool, { windowHours });
  return rollingSpend >= limit;
}

module.exports = {
  CostRecord,
  CostTracker,
  MODEL_RATES,
  recordSpendPg,
  getRollingSpendUsdPg,
  isOverBudgetDurable,
};
