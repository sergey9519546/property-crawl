---
description: Run the property-crawl test and verification gates, proportionally to the change.
agent: code
---

# /test

Run verification proportional to the change ($ARGUMENTS, optional suite name).

**Auto-detect (recommended)**: `node scripts/verify-gate.js` — classifies the change
(trivial / scraper / schema / runtime) and runs the proportionate suite, then emits
a machine-readable completion block with evidence.

**Manual selection**:

- `npm run test:unit` — one-line docs/typo change (fast client formula suite).
- `npm run test:scrapers` + `test:unit` — scraper/runtime change.
- `node --test test/context.test.js` — domain-model drift.
- `node --test test/skills-doctor.test.js` — skill-root hygiene.
- `node --test test/agent-system.test.js` — agent-system acceptance (Adversary scenarios 1–10).
- `npm test` — full 17-suite gate (build, canonical, playwright) pre-merge.

Always cite the actual pass/fail output before claiming "done". The verify-gate
script refuses to certify completion without an evidence citation.