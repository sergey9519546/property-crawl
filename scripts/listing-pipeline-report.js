'use strict';

/**
 * Listing pipeline quality report.
 * Shows inventory research-quality / opportunity distribution and source mix.
 */

const db = require('../server/db/client');
const { presentListing } = require('../server/routes/listings');
const { summarizeInventory } = require('../server/scrapers/listing-intelligence');

async function main() {
  const inventory = await db.getListings({ limit: 1000, offset: 0 });
  const listings = Array.isArray(inventory) ? inventory : inventory?.listings || [];
  const presented = listings.map((listing) => presentListing(listing));
  const summary = summarizeInventory(presented);

  console.log('=== Listing pipeline quality ===');
  console.log(`Total: ${summary.total}`);
  console.log(`Observed (live/source-backed): ${summary.observed}`);
  console.log(`With opening bid: ${summary.withOpeningBid}`);
  console.log(`Cross-source linked: ${summary.crossSourceLinked}`);
  console.log(`Avg research quality: ${summary.avgResearchQuality}/100`);
  console.log(`Avg opportunity rank: ${summary.avgOpportunityRank}/100`);
  console.log('--- Quality bands ---');
  for (const [band, count] of Object.entries(summary.byQualityBand)) {
    console.log(`  ${band}: ${count}`);
  }
  console.log('--- Sale urgency ---');
  for (const [urgency, count] of Object.entries(summary.bySaleUrgency)) {
    console.log(`  ${urgency}: ${count}`);
  }
  console.log('--- Top sources by volume ---');
  const sources = Object.entries(summary.bySource).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [source, count] of sources) {
    console.log(`  ${source}: ${count}`);
  }
  console.log(`Model: ${summary.model}`);
  console.log(summary.note);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
