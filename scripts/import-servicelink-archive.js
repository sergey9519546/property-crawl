'use strict';

/**
 * scripts/import-servicelink-archive.js
 *
 * Streaming archive importer for the ServiceLink Auction catalog:
 * - 5,900 listings and 40,578 image references in ServiceLink-Auction-GODMODE-Complete.zip
 *
 * Blueprint Invariants (AGENTS.md §10):
 *  1. Never equate "closed" with "sold". Use status "ended" or "completed" or map lifecycle appropriately.
 *  2. Strip fake/filler bids like bidsPlaced === 10 or bidsPlaced === "10" or "10.0".
 *  3. Never impute estLow, estHigh, or ARV from openingBid. Keep them null unless explicitly provided.
 *  4. Tag provenance.origin = "servicelink-archive", provenance.source = "servicelink".
 *  5. Extract and normalize image URLs into the photos array.
 *
 * CLI usage:
 *   node scripts/import-servicelink-archive.js [path/to/archive.zip] [--limit <N>] [--dry-run] [--out <path>] [--db]
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const { inspectImageUrl } = require('../server/scrapers/media-policy');
const { inspectSourceRecordUrl, hostnameMatches } = require('../server/scrapers/source-policy');
const {
  numberOrNull,
  normalizeApn,
  extractRawApn,
  extractCountyFips,
  buildParcelKey,
  computeTriage,
  observationTimestamp,
} = require('../server/scrapers/normalization');

const SOURCE_KEY = 'servicelink';
const PUBLISHER = 'ServiceLink Auction';
const DEFAULT_ZIP_PATH = 'C:/Users/serge/Downloads/ServiceLink-Auction-GODMODE-Complete.zip';
const CATALOG_ZIP_ENTRY = 'ServiceLink-Auction-GODMODE/servicelink-auction-catalog/catalog.jsonl';

function cleanText(value, option = 1_000) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (Array.isArray(option)) {
    const lowered = text.toLowerCase();
    if (option.some((placeholder) => lowered === String(placeholder).toLowerCase())) return null;
    return text;
  }
  const maximum = typeof option === 'number' ? option : 1_000;
  return text.slice(0, maximum);
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observedBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function validListingId(value) {
  const id = cleanText(value, 160);
  return id && /^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(id) ? id : null;
}

function dateOnly(value) {
  const text = cleanText(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString().slice(0, 10);
}

function sourceUrlFromRecord(record) {
  const candidates = [record?.propertyInfo?.websiteUrl, record?.canonicalUrl];
  for (const candidate of candidates) {
    const inspection = inspectSourceRecordUrl(SOURCE_KEY, candidate);
    if (inspection.isValid) return inspection.url;
  }
  return null;
}

function formatAddress(property) {
  const street = cleanText(property?.address, 300);
  const city = cleanText(property?.city, 150);
  const rawState = cleanText(property?.state);
  const state = rawState && /^[A-Za-z]{2}$/.test(rawState) ? rawState.toUpperCase() : null;
  const zip = cleanText(property?.postalCode, 20);
  if (!street || !state) return null;
  return [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function observedOpeningBid(record) {
  for (const field of ['openingBid', 'tpsOpenBid']) {
    const amount = finiteNumber(record?.[field]);
    if (amount !== null && amount > 0) return { amount, field };
  }
  return { amount: null, field: null };
}

function publisherGallery(record, sourceUrl, observedAt) {
  if (!Array.isArray(record?.images) || !inspectSourceRecordUrl(SOURCE_KEY, sourceUrl).isValid) return [];
  const gallery = [];
  for (let index = 0; index < record.images.length; index++) {
    const image = record.images[index];
    const field = ['mediaUrl', 'fileUrl', 'url', 'thumbnailUrl'].find(
      (name) => typeof image?.[name] === 'string' && image[name].trim()
    );
    if (!field) continue;
    const inspected = inspectImageUrl(image[field]);
    if (!inspected.accepted || !hostnameMatches(new URL(inspected.url).hostname, 'servicelinkauction.com')) continue;
    if (gallery.some((item) => item.url === inspected.url)) continue;
    gallery.push({
      url: inspected.url,
      sourceRecordUrl: sourceUrl,
      origin: 'publisher_record',
      verification: 'source_extracted',
      observedAt,
      extraction: { field: `images[${index}].${field}`, association: 'exact_publisher_listing_payload' },
    });
  }
  return gallery;
}

function publisherDocuments(record, sourceUrl, observedAt) {
  if (!Object.hasOwn(record || {}, 'documents')) return undefined;
  if (!Array.isArray(record.documents)) return undefined;
  if (!inspectSourceRecordUrl(SOURCE_KEY, sourceUrl).isValid) return undefined;
  return record.documents.map((document) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return {};
    const output = {};
    for (const field of ['title', 'label', 'name', 'documentName', 'documentType', 'accessState', 'access']) {
      const value = cleanText(document[field], 300);
      if (value) output[field] = value;
    }
    for (const field of ['fileUrl', 'mediaUrl', 'url', 'documentUrl', 'documentURL', 'thumbnailUrl']) {
      const value = cleanText(document[field], 2_000);
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && hostnameMatches(parsed.hostname, 'servicelinkauction.com')) {
          output[field] = parsed.href;
        }
      } catch {}
    }
    output.observedAt = observedAt;
    return output;
  });
}

function compactRawRecord(record, sourceUrl) {
  const property = record?.propertyInfo || {};
  const run = record?.auctionRunInfo || {};
  const status = record?.listingStatus || {};
  return JSON.stringify({
    listingId: cleanText(record?.listingId, 160),
    sourceUrl,
    auctionProgram: cleanText(record?.auctionProgram, 120),
    listingProgramWebsite: cleanText(record?.listingProgramWebsite, 240),
    createdDate: cleanText(record?.createdDate, 80),
    lastUpdated: cleanText(record?.lastUpdated, 80),
    timestamp: cleanText(record?.timestamp, 80),
    foreclosureSaleStatus: cleanText(record?.foreclosureSaleStatus, 240),
    foreclosureSaleStatusWebsite: cleanText(record?.foreclosureSaleStatusWebsite, 240),
    foreclosureSaleDate: cleanText(record?.foreclosureSaleDate, 80),
    tpsSaleLocation: cleanText(record?.tpsSaleLocation, 500),
    tpsSaleTime: cleanText(record?.tpsSaleTime, 80),
    clearedForSale: cleanText(record?.clearedForSale, 80),
    isCashOnly: observedBoolean(record?.isCashOnly),
    isFinancible: observedBoolean(record?.isFinancible),
    interiorAccessAvailable: observedBoolean(record?.interiorAccessAvailable),
    property: {
      propertyId: cleanText(property.propertyId, 160),
      globalPropertyId: cleanText(property.globalPropertyId, 160),
      assetNumber: cleanText(property.assetNumber, 160),
      type: cleanText(property.propertyType, 160),
      address: cleanText(property.address, 300),
      city: cleanText(property.city, 150),
      county: cleanText(property.county, 150),
      state: cleanText(property.state, 2),
      postalCode: cleanText(property.postalCode, 20),
      bedrooms: finiteNumber(property.bedrooms),
      bathrooms: finiteNumber(property.fullBathrooms),
      interiorSqFt: finiteNumber(property.interiorSqFt),
      lotSize: finiteNumber(property.lotSize),
      yearBuilt: finiteNumber(property.yearBuilt),
      latitude: finiteNumber(property.latitude),
      longitude: finiteNumber(property.longitude),
    },
    auctionRun: {
      auctionId: cleanText(run.auctionId, 160),
      awxId: cleanText(run.awxId, 160),
      auctionName: cleanText(run.auctionName, 240),
      auctionNumber: cleanText(run.auctionNumber, 160),
      auctionMethod: cleanText(run.auctionMethod, 120),
      startDate: cleanText(run.startDate, 80),
      endDate: cleanText(run.endDate, 80),
    },
    listingStatus: {
      statusText: cleanText(status.statusText, 240),
      statusTextSRP: cleanText(status.statusTextSRP, 240),
      isAuctionClosed: observedBoolean(status.isAuctionClosed),
      isInAuction: observedBoolean(status.isInAuction),
      isInPreAuction: observedBoolean(status.isInPreAuction),
      isInPostAuction: observedBoolean(status.isInPostAuction),
      isComingSoon: observedBoolean(status.isComingSoon),
    },
  });
}

/**
 * Normalizes a raw ServiceLink catalog record according to property-crawl schema
 * and strict Blueprint invariants (AGENTS.md §10).
 */
function normalizeServiceLinkRecord(record, options = {}) {
  if (!record || typeof record !== 'object') return null;

  const listingId = validListingId(record.listingId);
  const property = record.propertyInfo || {};
  const sourceUrl = sourceUrlFromRecord(record);
  const rawState = cleanText(property.state);
  const state = rawState && /^[A-Za-z]{2}$/.test(rawState) ? rawState.toUpperCase() : null;
  const formattedAddress = formatAddress(property);

  if (!listingId || !sourceUrl || !state || !formattedAddress) {
    return null;
  }

  // 1. Sale Date resolution
  const auctionProgram = cleanText(record.auctionProgram, 120);
  const isTrusteeProgram = /(^|\b)tps(\b|$)|trustee/i.test(auctionProgram || '');
  const publisherSaleDate = isTrusteeProgram
    ? dateOnly(record.foreclosureSaleDate)
    : dateOnly(record.auctionRunInfo?.startDate)
      || dateOnly(record.auctionRunInfo?.endDate)
      || dateOnly(record.foreclosureSaleDate);

  // 2. Opening Bid (publisher explicit field only)
  const opening = observedOpeningBid(record);

  // 3. Blueprint Invariant: Never impute estLow, estHigh, or ARV from openingBid.
  // Must remain null unless explicitly provided in the publisher payload.
  const estLow = numberOrNull(record.estLow, { min: Number.EPSILON });
  const estHigh = numberOrNull(record.estHigh, { min: Number.EPSILON });
  const arv = numberOrNull(record.arv ?? record.estValue ?? record.estimatedValue, { min: Number.EPSILON });

  // 4. Blueprint Invariant: Never equate "closed" with "sold". Use status "ended" or "completed".
  const statusObj = record.listingStatus || {};
  const rawStatus = cleanText(statusObj.statusText, 240)
    || cleanText(record.foreclosureSaleStatusWebsite, 240)
    || cleanText(record.foreclosureSaleStatus, 240)
    || cleanText(record.status, 240);

  const isAuctionClosed = statusObj.isAuctionClosed === true;
  let status = 'active';
  let lifecycleStatus = 'active';
  let transactionOutcome = null;

  const lowerRawStatus = (rawStatus || '').toLowerCase();
  const explicitlySold = /\bsold to (?:3rd party|third party)\b/i.test(rawStatus || '');
  const explicitlyReverted = /\breverted to beneficiary\b/i.test(rawStatus || '');
  const explicitlyCancelled = /\bcancell?ed\b|\brescinded\b|\bwithdrawn\b/i.test(rawStatus || '');
  const explicitlyPostponed = /\bpostpon(ed)?\b/i.test(rawStatus || '');
  const explicitlyClosed = isAuctionClosed || /\bclosed\b|\bauction is closed\b/i.test(rawStatus || '');

  if (explicitlySold) {
    status = 'completed';
    lifecycleStatus = 'completed';
    transactionOutcome = 'sold_to_third_party';
  } else if (explicitlyReverted) {
    status = 'ended';
    lifecycleStatus = 'ended';
    transactionOutcome = 'reverted_to_beneficiary';
  } else if (explicitlyCancelled) {
    status = 'cancelled';
    lifecycleStatus = 'cancelled';
  } else if (explicitlyClosed) {
    // Invariant: Never equate closed with sold
    status = 'ended';
    lifecycleStatus = 'ended';
  } else if (explicitlyPostponed) {
    status = 'postponed';
    lifecycleStatus = 'postponed';
  } else if (/\bcoming soon\b/i.test(lowerRawStatus)) {
    status = 'coming_soon';
    lifecycleStatus = 'upcoming';
  } else {
    status = 'active';
    lifecycleStatus = 'active';
  }

  // 5. Blueprint Invariant: Strip fake/filler bids like bidsPlaced === 10 or bidsPlaced === "10" or "10.0".
  let bidsPlaced = null;
  const rawBidsPlaced = record.bidsPlaced ?? record.customDetail?.of_bids__c;
  let rawBidsPlacedStripped = false;
  if (rawBidsPlaced !== null && rawBidsPlaced !== undefined) {
    const rawStr = String(rawBidsPlaced).trim();
    const parsedBids = Number(rawBidsPlaced);
    if (parsedBids === 10 || rawStr === '10' || rawStr === '10.0') {
      bidsPlaced = null; // STRIP filler bids
      rawBidsPlacedStripped = true;
    } else if (Number.isFinite(parsedBids) && parsedBids >= 0) {
      bidsPlaced = parsedBids;
    }
  }

  // 6. Blueprint Invariant: Extract and normalize image URLs into the photos array
  const photos = [];
  if (Array.isArray(record.images)) {
    for (let i = 0; i < record.images.length; i++) {
      const img = record.images[i];
      const url = cleanText(img?.mediaUrl || img?.fileUrl || img?.url || img?.thumbnailUrl);
      if (!url) continue;
      const inspected = inspectImageUrl(url);
      if (inspected.accepted && hostnameMatches(new URL(inspected.url).hostname, 'servicelinkauction.com')) {
        if (!photos.includes(inspected.url)) {
          photos.push(inspected.url);
        }
      }
    }
  }
  const photo = photos[0] || null;

  // 7. APN and County
  const rawApn = cleanText(property.assetNumber)
    || extractRawApn(record)
    || cleanText(record.apn)
    || cleanText(property.apn);
  const apn = normalizeApn(rawApn);
  const county = cleanText(property.county, ['County', 'Unknown']);
  const city = cleanText(property.city, ['City', 'Unknown']);
  const zip = cleanText(property.postalCode, ['00000', 'Unknown']);
  const title = cleanText(property.address) || formattedAddress;
  const propType = cleanText(property.propertyType, ['Unknown']);

  // Coordinates
  const latitude = finiteNumber(property.latitude);
  const longitude = finiteNumber(property.longitude);
  const hasGeocode = latitude !== null && latitude >= -90 && latitude <= 90
    && longitude !== null && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);

  // 8. Blueprint Invariant: Tag provenance.origin = "servicelink-archive", provenance.source = "servicelink"
  const observedAt = observationTimestamp(
    options.observedAt ?? record.timestamp ?? record.lastUpdated ?? record.createdDate
  );

  const gallery = publisherGallery(record, sourceUrl, observedAt);
  const documents = publisherDocuments(record, sourceUrl, observedAt);

  const provenance = {
    origin: 'servicelink-archive',
    source: SOURCE_KEY,
    recordKind: 'archive_record',
    recordId: listingId,
    publisher: PUBLISHER,
    exactSourceUrl: sourceUrl,
    observedAt,
    ...(hasGeocode ? {
      coordinates: {
        lat: latitude,
        lng: longitude,
        origin: 'publisher_record',
        verification: 'source_extracted',
        sourceRecordUrl: sourceUrl,
        observedAt,
      },
    } : {}),
    sourceFacts: {
      listingId,
      propertyId: cleanText(property.propertyId, 160),
      globalPropertyId: cleanText(property.globalPropertyId, 160),
      assetNumber: cleanText(property.assetNumber, 160),
      auctionProgram,
      listingProgramWebsite: cleanText(record.listingProgramWebsite, 240),
      sourceStatus: rawStatus,
      isAuctionClosed: statusObj.isAuctionClosed ?? null,
      createdDate: cleanText(record.createdDate, 80),
      lastUpdated: cleanText(record.lastUpdated, 80),
      timestamp: cleanText(record.timestamp, 80),
      foreclosureSaleDate: cleanText(record.foreclosureSaleDate, 80),
      tpsSaleLocation: cleanText(record.tpsSaleLocation, 500),
      tpsSaleTime: cleanText(record.tpsSaleTime, 80),
      isCashOnly: observedBoolean(record.isCashOnly),
      isFinancible: observedBoolean(record.isFinancible),
      interiorAccessAvailable: observedBoolean(record.interiorAccessAvailable),
      bidCountReliability: 'not_established',
      sourceReportedBidCount: record.customDetail?.of_bids__c ?? null,
      rawBidsPlacedStripped,
      ...(documents !== undefined ? { documents } : {}),
    },
    media: {
      photo,
      photos,
      gallery,
    },
  };

  const rawNotice = compactRawRecord(record, sourceUrl);

  const normalized = {
    id: `servicelink:${listingId}`,
    source: SOURCE_KEY,
    title,
    address: formattedAddress,
    city,
    state,
    zip,
    county,
    apn: apn || null,
    propType,
    openingBid: opening.amount,
    estLow,
    estHigh,
    arv,
    assessed: null,
    mid: null,
    ratio: null,
    bidSpread: null,
    equity: null,
    dealScore: null,
    saleDate: publisherSaleDate,
    status,
    lifecycleStatus,
    transactionOutcome,
    bidsPlaced,
    lat: hasGeocode ? latitude : null,
    lng: hasGeocode ? longitude : null,
    beds: finiteNumber(property.bedrooms),
    baths: finiteNumber(property.fullBathrooms),
    sqft: finiteNumber(property.interiorSqFt),
    year: finiteNumber(property.yearBuilt),
    occupancy: cleanText(property.occupancyStatus, 120),
    photo,
    photos,
    images: photos,
    sourceUrl,
    raw: rawNotice,
    listingDate: cleanText(record.createdDate, 80),
    auctionProgram,
    provenance,
    sourceObservedAt: observedAt,
  };

  normalized.parcelKey = buildParcelKey({
    apn: normalized.apn,
    countyFips: extractCountyFips(normalized),
  });
  normalized.triage = computeTriage(normalized);

  return normalized;
}

/**
 * Creates a stream of raw JSON objects from an archive (.zip) or a .jsonl file.
 */
function createArchiveInputStream(inputPath) {
  const resolved = path.resolve(inputPath || DEFAULT_ZIP_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Archive input file not found: ${resolved}`);
  }

  const isZip = resolved.toLowerCase().endsWith('.zip');

  if (!isZip) {
    // Uncompressed file or extracted catalog.jsonl
    return {
      stream: fs.createReadStream(resolved, { encoding: 'utf8' }),
      cleanup: () => {},
    };
  }

  // For zip archives, spawn tar.exe to stream the catalog.jsonl entry to stdout
  const tarExecutable = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const child = spawn(tarExecutable, ['-xf', resolved, '-O', CATALOG_ZIP_ENTRY]);

  let killed = false;
  const cleanup = () => {
    if (!killed) {
      killed = true;
      try { child.kill(); } catch {}
    }
  };

  child.stderr.on('data', () => {}); // swallow stderr
  child.on('error', (err) => {
    cleanup();
  });

  return {
    stream: child.stdout,
    cleanup,
  };
}

/**
 * Async generator that yields parsed JSON records from the archive stream.
 */
async function* streamArchiveRecords(inputPath, options = {}) {
  const { stream, cleanup } = createArchiveInputStream(inputPath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;
  const limit = options.limit ? Number(options.limit) : Infinity;

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      count++;
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield { record, index: count };
      if (count >= limit) break;
    }
  } finally {
    rl.close();
    cleanup();
  }
}

/**
 * Main import runner supporting CLI flags.
 */
async function importArchive(options = {}) {
  const {
    inputPath = DEFAULT_ZIP_PATH,
    limit = null,
    dryRun = false,
    outPath = null,
    useDb = false,
    logger = console.log,
  } = options;

  logger(`[ServiceLink Importer] Target archive: ${inputPath}`);
  logger(`[ServiceLink Importer] Configuration: limit=${limit || 'all'}, dryRun=${dryRun}, out=${outPath || 'none'}, db=${useDb}`);

  let dbClient = null;
  if (useDb) {
    try {
      dbClient = require('../server/db/client');
      logger(`[ServiceLink Importer] Database client loaded (isPg=${Boolean(dbClient.isPg)})`);
    } catch (err) {
      logger(`[ServiceLink Importer] Failed to load DB client: ${err.message}`);
    }
  }

  let outStream = null;
  if (outPath && !dryRun) {
    const resolvedOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    outStream = fs.createWriteStream(resolvedOut, { flags: 'w', encoding: 'utf8' });
  }

  const stats = {
    totalRead: 0,
    accepted: 0,
    skipped: 0,
    totalImages: 0,
    fakeBidsStripped: 0,
    closedNotSold: 0,
    estLowNull: 0,
    dbSaved: 0,
  };

  const startTime = Date.now();

  for await (const { record, index } of streamArchiveRecords(inputPath, { limit })) {
    stats.totalRead++;

    const normalized = normalizeServiceLinkRecord(record);
    if (!normalized) {
      stats.skipped++;
      continue;
    }

    stats.accepted++;
    stats.totalImages += normalized.photos.length;

    if (normalized.provenance.sourceFacts.rawBidsPlacedStripped) {
      stats.fakeBidsStripped++;
    }

    if (normalized.status === 'ended' || normalized.status === 'completed') {
      stats.closedNotSold++;
    }

    if (normalized.estLow === null) {
      stats.estLowNull++;
    }

    if (outStream) {
      outStream.write(JSON.stringify(normalized) + '\n');
    }

    if (dbClient && !dryRun) {
      try {
        await dbClient.createListing(normalized);
        stats.dbSaved++;
      } catch (err) {
        // Log individual DB errors without halting stream
      }
    }

    if (stats.accepted % 1000 === 0) {
      logger(`[ServiceLink Importer] Processed ${stats.accepted} records (${stats.totalImages} images)...`);
    }
  }

  if (outStream) {
    await new Promise((resolve) => outStream.end(resolve));
    logger(`[ServiceLink Importer] Wrote ${stats.accepted} records to ${outPath}`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  logger(`[ServiceLink Importer] Complete in ${durationSec}s:`);
  logger(`  Total read:          ${stats.totalRead}`);
  logger(`  Accepted:            ${stats.accepted}`);
  logger(`  Skipped:             ${stats.skipped}`);
  logger(`  Total images:        ${stats.totalImages}`);
  logger(`  Fake bids stripped:  ${stats.fakeBidsStripped}`);
  logger(`  Closed (not sold):   ${stats.closedNotSold}`);
  logger(`  estLow is null:      ${stats.estLowNull}`);
  if (useDb) logger(`  DB saved:            ${stats.dbSaved}`);

  return stats;
}

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_ZIP_PATH;
  let limit = null;
  let dryRun = false;
  let outPath = null;
  let useDb = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && args[i + 1]) {
      limit = Number(args[++i]);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--out' && args[i + 1]) {
      outPath = args[++i];
    } else if (arg === '--db') {
      useDb = true;
    } else if (!arg.startsWith('--')) {
      inputPath = arg;
    }
  }

  importArchive({ inputPath, limit, dryRun, outPath, useDb })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ServiceLink Importer] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  SOURCE_KEY,
  PUBLISHER,
  DEFAULT_ZIP_PATH,
  CATALOG_ZIP_ENTRY,
  normalizeServiceLinkRecord,
  createArchiveInputStream,
  streamArchiveRecords,
  importArchive,
};
