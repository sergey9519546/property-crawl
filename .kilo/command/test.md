---
description: Run the property-crawl test and verification gates, proportionally to the change.
agent: code
---

# /test

Run verification proportional to the change ($ARGUMENTS, optional suite name).

- `npm run test:unit` — one-line docs/typo change (fast client formula suite).
- `npm run test:scrapers` + `test:unit` — scraper/runtime change.
- `node --test test/context.test.js` — domain-model drift.
- `node --test test/skills-doctor.test.js` — skill-root hygiene.
- `npm test` — full 11-suite gate (build, canonical, playwright) pre-merge.

Always cite the actual pass/fail output before claiming "done".