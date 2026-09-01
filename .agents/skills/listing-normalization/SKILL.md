---
name: listing-normalization
description: |
  Canonical listing contract for property-crawl: every scraper output must conform
  to the camelCase schema with required fields, type constraints, and validation.
  Use this when normalizing raw scraper data into the standard listing shape.
license: MIT
metadata:
  version: v1
  domain: property-data
---

# Listing Normalization Skill

Use this skill when normalizing raw scraper output into the canonical listing contract.

## Canonical Listing Contract

Every listing MUST conform to this shape (camelCase):

```json
{
  "id": "string (unique, format: STATE-COUNTY-NUMBER)",
  "source": "string (must match a SOURCES key)",
  "state": "string (2-letter ISO)",
  "county": "string",
  "city": "string",
  "zip": "string",
  "address": "string",
  "lat": "number | null",
  "lng": "number | null",
  "openingBid": "number > 0",
  "estLow": "number | null",
  "estHigh": "number | null",
  "assessed": "number | null",
  "saleDate": "ISO date string | null",
  "plaintiff": "string",
  "defendant": "string",
  "attorney": "string | null",
  "judgment": "number | null",
  "occupancy": "string | null",
  "deposit": "number | null",
  "photo": "URL string | null",
  "sourceUrl": "URL string (must NOT be a generic source homepage)",
  "raw": "string (original legal notice text)"
}
```

## Rules

1. **CamelCase only**: Postgres stores snake_case; `server/db/client.js` aliases back. Never use snake_case in scraper output.
2. **Required fields**: `id`, `source`, `state`, `address`, `openingBid`. All others nullable.
3. **No zero-byte payloads**: Never overwrite existing records with empty/403 error responses (circuit breaker enforces this).
4. **Source URL**: Must point to the specific listing page, never the generic source homepage.
5. **ID format**: `STATE-COUNTY-NUMBER` (e.g., `OH-CUY-10231`).
6. **Source key**: Must match an existing key in `SOURCES` (see `data.js`).

## Related

- `property-scraper-engineering` — how to build resilient scrapers that produce this contract
- `foreclosure-title-intelligence` — legal text parsing and risk annotation
- `deal-scoring` — how `openingBid` feeds into the Deal Score formula
