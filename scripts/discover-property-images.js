#!/usr/bin/env node
'use strict';
const db = require('../server/db/client');
const { SecondaryMediaCollector } = require('../server/scrapers/secondary-media-collector');
const { inspectPublisherPhoto } = require('../server/scrapers/media-policy');
const { exactAddress, inspectSecondaryMedia } = require('../server/scrapers/secondary-property-media');
const { readMediaStore, attachMedia, saveMedia } = require('../server/db/property-media-store');

async function main(args) {
  let id, limit = 3; const urls = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) id = args[++i];
    else if (args[i] === '--url' && args[i + 1]) urls.push(args[++i]);
    else if (args[i] === '--limit' && /^[1-9]$|^10$/.test(args[i + 1] || '')) limit = Number(args[++i]);
    else throw new Error('Use --id RECORD_ID [--url EXACT_PROPERTY_PAGE] or --limit 1..10');
  }
  if (urls.length && !id) throw new Error('--url requires one canonical --id');
  const entries = readMediaStore();
  const records = id ? [await db.getListingById(id)].filter(Boolean) : (await db.getListings({ limit: 1000 })).listings.filter(record => exactAddress(record) && !inspectPublisherPhoto(record).accepted && !inspectSecondaryMedia(attachMedia(record, entries)).accepted).slice(0, limit);
  if (!records.length) throw new Error('No matching records');
  const collector = new SecondaryMediaCollector();
  for (const listing of records) {
    const result = await collector.collect(listing, urls);
    if (result.accepted) saveMedia(listing, result.media);
    console.log(JSON.stringify({ listingId: listing.id, address: listing.address, accepted: result.accepted, images: result.media?.images.length || 0, reason: result.reason, attempts: result.attempts }));
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
