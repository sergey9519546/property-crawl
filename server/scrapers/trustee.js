// server/scrapers/trustee.js
//
// Trustee's Sale Non-Judicial Foreclosure Scraper.
// Source: County Recorders & Statutory Non-Judicial Foreclosure Registries
//
// Scrapes non-judicial power-of-sale auction notices under deed of trust state statutes.

const BaseScraper = require('./base');

class TrusteeSaleScraper extends BaseScraper {
  constructor() {
    super({ name: 'TrusteeSaleScraper', sourceKey: 'trustee' });
    this.timeoutMs = 15000;
    this.fixtureOnly = true;
  }

  async scrapeFeed() {
    console.warn(`[${this.name}] No live collector is implemented; fixture inventory is excluded from ingestion.`);
    return [];
  }

  // Demo/Unsplash inventory overrides removed (2026-09-14 audit).
  // Live collectors must not fabricate listings; BaseScraper may still read
  // data/listings.snapshot.json as explicitly labeled fixture evidence.
}

module.exports = new TrusteeSaleScraper();
