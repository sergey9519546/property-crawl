/**
 * Bidding Intelligence & Underwriting Simulator
 * Models Max Allowable Offer (MAO), hold costs, and competitive auction clearing probabilities.
 */

class BiddingSimulator {
  /**
   * Computes the 70% ARV Max Allowable Offer (MAO).
   * @param {Object} [params={}]
   * @param {number} [params.arv=0] - After Repair Value
   * @param {number} [params.rehabBudget=0] - Estimated rehab scope
   * @param {number} [params.cashToClose=0] - Title, escrow, and statutory closing costs
   * @param {number} [params.targetProfit=0] - Target net profit ($)
   * @param {number} [params.targetPercentage=0.7] - Typical institutional target is 70%
   * @param {number} [params.holdingCosts=0] - Carry costs, loan points, etc.
   * @returns {number} The maximum allowable offer
   */
  static calculateMAO({
    arv = 0,
    rehabBudget = 0,
    cashToClose = 0,
    targetProfit = 0,
    targetPercentage = 0.7,
    holdingCosts = 0
  } = {}) {
    const arvNum = Number(arv) || 0;
    if (arvNum <= 0) return 0;
    const rehab = Number(rehabBudget) || 0;
    const ctc = Number(cashToClose) || 0;
    const profit = Number(targetProfit) || 0;
    const pct = Number(targetPercentage) || 0.7;
    const holding = Number(holdingCosts) || 0;

    const mao = (arvNum * pct) - rehab - ctc - profit - holding;
    return Math.max(0, Math.floor(Number.isFinite(mao) ? mao : 0));
  }

  /**
   * Models Holding & Financing Carry Cost Drag
   * @param {Object} [params={}]
   * @param {number|string} [params.purchasePrice=0] - Expected purchase price
   * @param {number|string} [params.rehabBudget=0] - Rehab budget
   * @param {number} [params.loanPoints=2] - Origination points
   * @param {number} [params.interestRate=0.12] - Annual interest rate for hard money
   * @param {number} [params.holdMonths=6] - Expected hold time
   * @param {number} [params.transferTaxRate=0.01] - State/County transfer tax rate
   * @returns {number} Estimated holding cost drag
   */
  static calculateHoldingCosts({
    purchasePrice = 0,
    rehabBudget = 0,
    loanPoints = 2,
    interestRate = 0.12,
    holdMonths = 6,
    transferTaxRate = 0.01
  } = {}) {
    const price = Number(purchasePrice) || 0;
    const rehab = Number(rehabBudget) || 0;
    const points = Number(loanPoints) || 0;
    const rate = Number(interestRate) || 0;
    const months = Number(holdMonths) || 0;
    const taxRate = Number(transferTaxRate) || 0;

    const loanAmount = price + rehab;
    const pointsCost = loanAmount * (points / 100);
    const interestCost = loanAmount * (rate / 12) * months;
    const transferTax = price * taxRate;
    const insuranceAndTaxes = (price * 0.02 / 12) * months; // ~2% annual for property tax + insurance
    
    const total = pointsCost + interestCost + transferTax + insuranceAndTaxes;
    return Math.floor(Number.isFinite(total) ? Math.max(0, total) : 0);
  }

  /**
   * Forecasts the probability of clearing at an auction based on county and plaintiff upset bid.
   * Institutional logic dictates that plaintiffs usually bid up to judgment minus 10%.
   * Supports both canonical listing schema (judgment, assessed) and raw (debt, assessedValue).
   * @param {Object} [listing={}]
   * @param {number} targetBid - The investor's intended bid
   * @returns {Object} Probability metrics (winProbability, expectedClearingPrice, plaintiffUpsetRisk, upsetBidCeiling)
   */
  static simulateClearingProbability(listing = {}, targetBid = 0) {
    if (!listing) listing = {};
    const bid = Number(targetBid) || 0;
    const openBid = Number(listing.openingBid) || 0;
    const debt = Number(listing.judgment ?? listing.debt ?? 0);
    const assessedValue = Number(listing.assessed ?? listing.assessedValue ?? 0);
    
    // Determine the likely plaintiff upset bid threshold (where the bank stops bidding)
    let upsetBidCeiling = 0;
    if (debt > 0) {
      // Banks typically bid up to their debt amount or ~80% of assessed value to avoid taking REO
      upsetBidCeiling = Math.min(debt, assessedValue > 0 ? assessedValue * 0.8 : debt);
      if (upsetBidCeiling === 0) upsetBidCeiling = debt * 0.9;
    } else if (openBid > 0) {
      upsetBidCeiling = openBid;
    }
    
    // Calculate expected clearing price (competitive market estimate)
    // In competitive counties, properties clear at 60-80% of assessed value
    const marketClearingFloor = assessedValue * 0.6;
    const expectedClearingPrice = Math.max(upsetBidCeiling, marketClearingFloor);

    // Calculate Win Probability based on standard deviation curve around expected clearing price
    let winProbability = 0;
    if (bid < openBid) {
      winProbability = 0;
    } else if (expectedClearingPrice <= 0) {
      winProbability = bid >= openBid ? 70 : 0;
    } else if (bid >= expectedClearingPrice * 1.2) {
      winProbability = 99; // Overbidding significantly secures the win
    } else if (bid >= expectedClearingPrice) {
      // Linear scale from expected (50%) to expected * 1.2 (99%)
      const excess = bid - expectedClearingPrice;
      const margin = (expectedClearingPrice * 1.2) - expectedClearingPrice;
      winProbability = margin > 0 ? (50 + (excess / margin) * 49) : 50;
    } else if (bid >= upsetBidCeiling) {
      // Linear scale from upset bid (10%) to expected (50%)
      const excess = bid - upsetBidCeiling;
      const margin = expectedClearingPrice - upsetBidCeiling;
      winProbability = 10 + (margin > 0 ? (excess / margin) * 40 : 0);
    } else {
      // Under upset bid
      winProbability = 5;
    }

    const safeWinProb = Math.min(100, Math.max(0, Math.floor(Number.isFinite(winProbability) ? winProbability : 0)));

    return {
      winProbability: safeWinProb,
      expectedClearingPrice: Math.floor(expectedClearingPrice),
      plaintiffUpsetRisk: bid < upsetBidCeiling,
      upsetBidCeiling: Math.floor(upsetBidCeiling)
    };
  }

  /**
   * Builds a strictly grounded offline narrative from observed listing fields and computed simulation metrics.
   * Enforces Zero-Fabrication by explicitly reporting absent debt/assessment/valuation figures.
   */
  static buildDeterministicNarrative(listing = {}, simulation = null, options = {}) {
    const safeListing = listing && typeof listing === 'object' ? listing : {};
    const targetBid = Number(options.targetBid ?? safeListing.openingBid ?? 0) || 0;
    const sim = simulation || BiddingSimulator.simulateClearingProbability(safeListing, targetBid);
    const openBid = Number(safeListing.openingBid);
    const debt = Number(safeListing.judgment ?? safeListing.debt);
    const assessed = Number(safeListing.assessed ?? safeListing.assessedValue);
    const lines = [
      `Target bid modeled: $${targetBid.toLocaleString('en-US')}.`,
      Number.isFinite(openBid) && openBid > 0
        ? `Published opening bid: $${openBid.toLocaleString('en-US')}.`
        : 'Published opening bid: unverified / omitted.',
      `Estimated clearing price (${sim.plaintiffUpsetRisk ? 'below' : 'at/above'} upset ceiling $${sim.upsetBidCeiling.toLocaleString('en-US')}): $${sim.expectedClearingPrice.toLocaleString('en-US')}; modeled win probability ${sim.winProbability}%.`
    ];
    if (!Number.isFinite(debt) || debt <= 0) {
      lines.push('Judgment/debt balance not present in listing fields; plaintiff upset ceiling cannot be verified from docket debt.');
    }
    if (!Number.isFinite(assessed) || assessed <= 0) {
      lines.push('Assessed value not present in listing fields; market clearing floor relies strictly on bid/debt records.');
    }
    if (safeListing.estLow == null || safeListing.estHigh == null) {
      lines.push('Valuation range (estLow/estHigh) absent; no ARV is imputed.');
    }
    lines.push('Deterministic underwriting model only — not a bid recommendation or title clearance.');
    return lines.join(' ');
  }

  /**
   * Generates a grounded bidding analysis narrative, using an LLM when requested and an API key is available,
   * and cleanly falling back to the deterministic narrative offline or on provider error.
   */
  static async generateBiddingNarrative(listing = {}, simulation = null, options = {}) {
    const safeListing = listing && typeof listing === 'object' ? listing : {};
    const targetBid = Number(options.targetBid ?? safeListing.openingBid ?? 0) || 0;
    const sim = simulation || BiddingSimulator.simulateClearingProbability(safeListing, targetBid);
    const deterministic = BiddingSimulator.buildDeterministicNarrative(safeListing, sim, { targetBid });
    const env = options.env || process.env;
    const fetchFn = options.fetchFn || globalThis.fetch;
    const openaiKey = options.apiKey || env?.OPENAI_API_KEY || null;
    const geminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_AI_API_KEY || null;
    const wantsAi = Boolean(options.useAi);

    if (!wantsAi || typeof fetchFn !== 'function' || (!openaiKey && !geminiKey)) {
      return {
        narrative: deterministic,
        mode: 'deterministic',
        provider: null,
        model: 'bidding-narrative-deterministic-v1',
        verified: false,
        aiFallbackReason: wantsAi ? (typeof fetchFn !== 'function' ? 'fetch_unavailable' : 'api_key_missing') : 'ai_not_requested',
        simulation: sim,
      };
    }

    const prompt = [
      'Summarize ONLY the provided auction underwriting metrics and observed listing fields in 2-4 concise sentences.',
      'Zero-Fabrication Rule: Do NOT invent ARV, rehab costs, condition, occupancy, or lien status. Explicitly mention missing debt/assessed/valuation fields when null.',
      `Context: ${JSON.stringify({
        address: safeListing.address || null,
        state: safeListing.state || null,
        openingBid: safeListing.openingBid ?? null,
        debt: safeListing.judgment ?? safeListing.debt ?? null,
        assessedValue: safeListing.assessed ?? safeListing.assessedValue ?? null,
        estLow: safeListing.estLow ?? null,
        estHigh: safeListing.estHigh ?? null,
        targetBid,
        simulation: sim,
      })}`
    ].join('\n');

    const tryOpenAi = async () => {
      if (!openaiKey) return null;
      const model = options.model || 'gpt-4o-mini';
      const resp = await fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
        signal: options.signal || AbortSignal.timeout(8000),
      });
      if (!resp || !resp.ok) return null;
      const body = await resp.json();
      const text = body?.choices?.[0]?.message?.content?.trim();
      return text ? { narrative: text, provider: 'openai', model } : null;
    };

    const tryGemini = async () => {
      if (!geminiKey) return null;
      const model = options.model || 'gemini-2.0-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
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
      return text ? { narrative: text, provider: 'gemini', model } : null;
    };

    const attempts = openaiKey ? [tryOpenAi, tryGemini] : [tryGemini, tryOpenAi];
    for (const attempt of attempts) {
      try {
        const res = await attempt();
        if (res && res.narrative) {
          return {
            narrative: res.narrative,
            mode: 'ai',
            provider: res.provider,
            model: res.model,
            verified: false,
            aiFallbackReason: null,
            simulation: sim,
          };
        }
      } catch (_) {
        // Fall through to alternate provider or deterministic baseline
      }
    }

    return {
      narrative: deterministic,
      mode: 'deterministic',
      provider: null,
      model: 'bidding-narrative-deterministic-v1',
      verified: false,
      aiFallbackReason: 'llm_unavailable',
      simulation: sim,
    };
  }
}

module.exports = {
  BiddingSimulator,
  buildDeterministicNarrative: BiddingSimulator.buildDeterministicNarrative,
  generateBiddingNarrative: BiddingSimulator.generateBiddingNarrative,
};
