const crypto = require('crypto');

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
 * Expected shape: { recipe: string, items: object[] }
 */
function validateScrapyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Payload must be a JSON object' };
  }

  const { recipe, items } = payload;

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
    items,
  };
}

module.exports = {
  SUPPORTED_RECIPES,
  verifyScrapySignature,
  validateScrapyPayload,
};
