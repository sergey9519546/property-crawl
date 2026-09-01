---
description: Run the scraper scheduler to refresh listing data from all government/auction sources.
---

# /scrape

Run the scraping scheduler: `npm run scrape` (or `node server/scrapers/scheduler.js`).

- Normalize every source into the canonical listing contract (camelCase, matching `server/db/client.js`).
- Respect rate limits and circuit breakers per the `property-scraper-engineering` skill.
- On any source failure, emit a per-source error record — partial success, never silent drop.

Related: `npm run refresh-data:real` for a live network scrape.