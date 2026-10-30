const crypto = require('crypto');
const { servesListings } = require('../sources/catalog');
const { validateListingForIngestion } = require('../scrapers/validation');
const { resolveLiveStorePath, mergeLiveRecords } = require('../db/live-record-store');

const SUPPORTED_RECIPES = Object.freeze([
  'foreclosure',
  'probate',
  'code_violation',
  'sale',
  'auction',
  'parcel',
  'listing',
]);

/**
 * Verifies Scrapy Cloud / Zyte push webhook signature.
 * Contract per zyte-scrapy skill:
 * HMAC-SHA256 (hex) over raw request body using SCRAPY_INGEST_SECRET.
 * Header: `x-signature: <hex>` (no sha256= prefix).
 */
function verifyScrapySignature(rawBody, signatureHeader, secret = process.env.SCRAPY_INGEST_SECRET) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return { valid: false, status: 503, error: 'Scrapy ingest secret not configured' };
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { valid: false, status: 401, error: 'Missing signature header' };
  }

  const cleanSig = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanSig)) {
    return { valid: false, status: 401, error: 'Invalid signature format' };
  }

  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody : String(rawBody || ''));
    const expectedSig = hmac.digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const providedBuf = Buffer.from(cleanSig, 'utf8');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: false, status: 401, error: 'Invalid signature' };
    }

    return { valid: true };
  } catch {
    return { valid: false, status: 401, error: 'Signature verification failed' };
  }
}

/**
 * Validates and sanitizes Scrapy Cloud ingest batch payload.
 * Expected shape: { recipe: string, items: object[], spider?: string, source?: string }
 */
function validateScrapyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Payload must be a JSON object' };
  }

  const { recipe, items, spider, source } = payload;

  if (typeof recipe !== 'string' || !SUPPORTED_RECIPES.includes(recipe.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported recipe. Supported: ${SUPPORTED_RECIPES.join(', ')}`,
    };
  }

  if (!Array.isArray(items)) {
    return { valid: false, error: 'Field "items" must be an array' };
  }

  return {
    valid: true,
    recipe: recipe.toLowerCase(),
    spider: typeof spider === 'string' && spider.trim() ? spider.trim() : null,
    source: typeof source === 'string' && source.trim() ? source.trim().toLowerCase() : null,
    items,
  };
}

/**
 * Enforces the listing admission and schema/provenance validation gate on a single
 * Scrapy ingest candidate before it can reach either the live file store or Postgres.
 */
function gateScrapyItemForIngestion(item, options = {}) {
  const servesListingsImpl = typeof options.servesListingsImpl === 'function'
    ? options.servesListingsImpl
    : servesListings;
  const validateListingImpl = typeof options.validateListingImpl === 'function'
    ? options.validateListingImpl
    : validateListingForIngestion;

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { isValid: false, errors: ['invalid_item_object'], listing: null, source: '' };
  }

  const candidateSource = String(item.source || options.sourceKey || '').trim().toLowerCase();
  if (!candidateSource || !servesListingsImpl(candidateSource)) {
    return {
      isValid: false,
      errors: ['source_not_serving_listings'],
      listing: null,
      source: candidateSource,
    };
  }

  const candidateItem = item.source ? item : { ...item, source: candidateSource };
  const validation = validateListingImpl(candidateItem, {
    expectedSource: candidateSource,
    sourceKey: candidateSource,
    quarantineInvalid: false,
  });

  if (!validation || !validation.isValid) {
    return {
      isValid: false,
      errors: Array.isArray(validation?.errors) && validation.errors.length
        ? validation.errors
        : ['invalid_listing'],
      listing: null,
      source: candidateSource,
    };
  }

  const prov = validation.listing.provenance && typeof validation.listing.provenance === 'object'
    ? validation.listing.provenance
    : {};
  if ((prov.origin && prov.origin !== 'live') || (prov.recordKind && prov.recordKind !== 'source_record')) {
    return {
      isValid: false,
      errors: ['non_live_provenance'],
      listing: null,
      source: candidateSource,
    };
  }

  const listing = {
    ...validation.listing,
    provenance: {
      ...prov,
      origin: 'live',
      recordKind: 'source_record',
    },
  };

  return {
    isValid: true,
    errors: [],
    listing,
    source: candidateSource,
  };
}

/**
 * Validates and persists a batch of Scrapy items into the live store and (when
 * active) the primary PostgreSQL database, returning accurate accepted/rejected
 * accounting for the active serving store.
 */
async function ingestScrapyItems(items, options = {}) {
  const candidateItems = Array.isArray(items) ? items : [];
  const sourceKey = typeof options.sourceKey === 'string' && options.sourceKey.trim()
    ? options.sourceKey.trim().toLowerCase()
    : undefined;
  const servesListingsImpl = typeof options.servesListingsImpl === 'function'
    ? options.servesListingsImpl
    : servesListings;
  const validateListingImpl = typeof options.validateListingImpl === 'function'
    ? options.validateListingImpl
    : validateListingForIngestion;
  const mergeLiveRecordsImpl = typeof options.mergeLiveRecordsImpl === 'function'
    ? options.mergeLiveRecordsImpl
    : mergeLiveRecords;
  const liveStorePath = options.liveStorePath || resolveLiveStorePath();
  const logger = options.logger || console;

  const admissibleItems = [];
  let gateRejected = 0;

  for (const item of candidateItems) {
    const gated = gateScrapyItemForIngestion(item, {
      sourceKey,
      servesListingsImpl,
      validateListingImpl,
    });
    if (!gated.isValid || !gated.listing) {
      gateRejected++;
      logger.warn?.(
        `[Scrapy Ingest] Rejected item ${item && item.id ? item.id : '<missing-id>'}: ${gated.errors.join(', ')}`
      );
      continue;
    }
    admissibleItems.push(gated.listing);
  }

  let liveAccepted = 0;
  let liveRejected = 0;
  let totalLive = 0;

  if (admissibleItems.length > 0) {
    try {
      const merged = mergeLiveRecordsImpl(
        liveStorePath,
        admissibleItems,
        sourceKey ? { sourceKey } : {}
      );
      liveAccepted = merged?.accepted || 0;
      liveRejected = merged?.rejected || 0;
      totalLive = merged?.retained || 0;
    } catch (err) {
      logger.error?.('[Scrapy Ingest] Live record store merge failed:', err?.message);
    }
  }

  let isPostgres = Boolean(options.isPostgres);
  let pgAccepted = 0;
  let pgFailed = 0;

  try {
    const db = options.db !== undefined ? options.db : require('../db/client');
    if (db) {
      if (typeof db.verifyConnection === 'function' && !db.postgresReachable && db.pool) {
        await db.verifyConnection().catch(() => {});
      }
      if (options.isPostgres === undefined) {
        isPostgres = Boolean(db.isPg || (typeof db.dataMode === 'function' ? db.dataMode() === 'postgres' : false));
      }
      if (isPostgres && admissibleItems.length > 0 && typeof db.createListing === 'function') {
        for (const validListing of admissibleItems) {
          try {
            await db.createListing(validListing);
            pgAccepted++;
          } catch (createErr) {
            pgFailed++;
            logger.error?.(
              `[Scrapy Ingest] PostgreSQL createListing failed for ${validListing.id}:`,
              createErr?.message
            );
          }
        }
      }
    }
  } catch (dbErr) {
    logger.error?.('[Scrapy Ingest] Database persistence failed:', dbErr?.message);
  }

  const accepted = isPostgres ? pgAccepted : liveAccepted;
  const rejected = isPostgres ? gateRejected + pgFailed : gateRejected + liveRejected;

  return {
    received: candidateItems.length,
    accepted,
    rejected,
    totalLive,
    isPostgres,
    postgresAccepted: pgAccepted,
    postgresRejected: gateRejected,
    postgresFailed: pgFailed,
    liveAccepted,
    liveRejected,
  };
}

module.exports = {
  SUPPORTED_RECIPES,
  verifyScrapySignature,
  validateScrapyPayload,
  gateScrapyItemForIngestion,
  ingestScrapyItems,
};
