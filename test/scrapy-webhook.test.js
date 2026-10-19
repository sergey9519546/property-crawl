const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  verifyScrapySignature,
  validateScrapyPayload,
  SUPPORTED_RECIPES,
} = require('../server/ingest/scrapy-webhook');

function signPayload(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('verifyScrapySignature: fails closed when secret is unset', () => {
  const result = verifyScrapySignature('{"test":1}', 'some-sig', '');
  assert.equal(result.valid, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /not configured/);
});

test('verifyScrapySignature: rejects missing or invalid format signatures', () => {
  const secret = 'test-secret-key-12345';
  
  // Missing header
  const missing = verifyScrapySignature('{"test":1}', null, secret);
  assert.equal(missing.valid, false);
  assert.equal(missing.status, 401);

  // Invalid hex format (not 64 hex chars)
  const malformed = verifyScrapySignature('{"test":1}', 'not-a-valid-hex-signature', secret);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.status, 401);
  assert.match(malformed.error, /format/);
});

test('verifyScrapySignature: rejects forged signature with constant-time comparison', () => {
  const secret = 'test-secret-key-12345';
  const fakeSig = crypto.randomBytes(32).toString('hex');
  const result = verifyScrapySignature('{"recipe":"foreclosure","items":[]}', fakeSig, secret);
  assert.equal(result.valid, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'Invalid signature');
});

test('verifyScrapySignature: accepts valid HMAC-SHA256 signature', () => {
  const secret = 'production-grade-scrapy-secret-67890';
  const body = JSON.stringify({ recipe: 'foreclosure', items: [{ id: 'FC-101', county: 'Harris' }] });
  const validSig = signPayload(body, secret);

  const result = verifyScrapySignature(body, validSig, secret);
  assert.equal(result.valid, true);
});

test('validateScrapyPayload: enforces recipe schema and items array', () => {
  // Non-object
  assert.equal(validateScrapyPayload(null).valid, false);
  assert.equal(validateScrapyPayload('string').valid, false);
  assert.equal(validateScrapyPayload([]).valid, false);

  // Unsupported recipe
  const badRecipe = validateScrapyPayload({ recipe: 'invalid_recipe', items: [] });
  assert.equal(badRecipe.valid, false);
  assert.match(badRecipe.error, /Unsupported recipe/);

  // Missing or non-array items
  const nonArrayItems = validateScrapyPayload({ recipe: 'foreclosure', items: 'not-an-array' });
  assert.equal(nonArrayItems.valid, false);
  assert.match(nonArrayItems.error, /must be an array/);

  // Valid for all supported recipes
  for (const recipe of SUPPORTED_RECIPES) {
    const valid = validateScrapyPayload({ recipe, items: [{ recordId: 1 }] });
    assert.equal(valid.valid, true);
    assert.equal(valid.recipe, recipe);
    assert.equal(valid.items.length, 1);
  }
});

test('scrapy webhook route handler declares GET and POST with HMAC verification', () => {
  const fs = require('fs');
  const path = require('path');
  const routePath = path.join(__dirname, '../src/app/api/public/scrapy-ingest/route.ts');
  assert.ok(fs.existsSync(routePath), 'scrapy-ingest route.ts must exist');

  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /verifyScrapySignature/);
  assert.match(source, /validateScrapyPayload/);
  assert.match(source, /x-signature/);
  assert.doesNotMatch(source, /issueWorkspaceSession|SCRAPER_ADMIN_TOKEN/);
});

