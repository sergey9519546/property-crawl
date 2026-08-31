---
name: property-scraper-engineering
description: |
  Patterns and best practices for building resilient government auction scrapers,
  county docket crawlers, circuit breaker protection, WAF bypass, and anti-poisoning data gates.
license: MIT
metadata:
  version: v1
  domain: data-engineering
---

# Property Scraper Engineering Skill

Use this skill when building or repairing scrapers for county sheriff portals, Bid4Assets, GovDeals, HUD HomeStore, USDA, Treasury, or IRS disposition sites.

## Core Engineering Directives

1. **Circuit Breaker Enforcement**:
   - Wrap all external network requests in `ScraperCircuitBreaker`.
   - Never overwrite existing database records or listing registries with 0-byte or 403 error payloads.
   - Halt execution and emit telemetry on Cloudflare / Akamai / CAPTCHA challenge walls.

2. **Schema Normalization**:
   - All listings must standardize into the canonical listing contract:
     `{ id, source, state, county, city, zip, address, lat, lng, openingBid, estLow, estHigh, assessed, saleDate, plaintiff, defendant, attorney, judgment, occupancy, deposit, photo, sourceUrl, raw }`.

3. **OCR & Text Cleaning**:
   - Pass all raw legal notices through `normalizeOcrText` to repair OCR letter-for-number substitutions (`$12O,OOO` -> `$120,000`).

4. **Rate Limiting & Politeness**:
   - Implement randomized jitter (250ms–750ms) between page crawls to respect county server bandwidth.
