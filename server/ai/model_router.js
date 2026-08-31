class ModelRouter {
  static selectModel({ taskType = 'notice_parser', promptLength = 0, isHighComplexity = false }) {
    // 1. Notice parsing: structured JSON extraction works efficiently on high-speed flash
    if (taskType === 'notice_parser') {
      if (promptLength > 4000 || isHighComplexity) {
        return 'gemini-2.0-flash';
      }
      return 'gemini-2.0-flash-lite';
    }

    // 2. Risk analysis / 'Here's the catch' synthesis: requires nuanced reasoning
    if (taskType === 'deal_analysis') {
      return 'gpt-4o-mini';
    }

    // 3. Multi-source comps valuation
    if (taskType === 'comp_valuation') {
      return isHighComplexity ? 'gpt-4o' : 'gpt-4o-mini';
    }

    return 'gemini-2.0-flash';
  }
}

module.exports = ModelRouter;
