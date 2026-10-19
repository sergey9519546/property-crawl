'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  checkoutConfigured,
  createCheckoutSession,
  verifyStripeWebhook,
  stripeWebhookConfigured,
} = require('../server/billing/stripe-checkout');

test('checkout fails closed without Stripe secrets and does not call Stripe', async () => {
  let called = false;
  const result = await createCheckoutSession({
    successUrl: 'https://property-crawl.com/checkout?status=returned',
    cancelUrl: 'https://property-crawl.com/checkout?status=cancelled',
    env: {},
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/x' }) }; },
  });
  assert.equal(checkoutConfigured({}), false);
  assert.equal(result.configured, false);
  assert.equal(result.status, 503);
  assert.equal(result.url, null);
  assert.equal(called, false);
});

test('checkout returns the Stripe URL and does not invent a paid account', async () => {
  const result = await createCheckoutSession({
    successUrl: 'https://property-crawl.com/checkout?status=returned',
    cancelUrl: 'https://property-crawl.com/checkout?status=cancelled',
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_ID: 'price_test' },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
      assert.match(init.headers.Authorization, /^Bearer sk_test$/);
      assert.match(String(init.body), /price_test/);
      return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test', id: 'cs_test' }) };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test');
  assert.equal(result.paid, undefined);
});

test('checkout route does not issue an operator session', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app/api/checkout/route.ts'), 'utf8');
  assert.match(source, /createCheckoutSession/);
  assert.doesNotMatch(source, /issueWorkspaceSession|SCRAPER_ADMIN_TOKEN|paid:\s*true/);
});

test('verifyStripeWebhook fails closed when STRIPE_WEBHOOK_SECRET is unset', () => {
  assert.equal(stripeWebhookConfigured({}), false);
  const result = verifyStripeWebhook({
    signatureHeader: 't=1700000000,v1=abcdef',
    rawBody: '{"id":"evt_test"}',
    env: {},
  });
  assert.equal(result.configured, false);
  assert.equal(result.valid, false);
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'webhook-not-configured');
});

test('verifyStripeWebhook rejects missing or malformed signature headers', () => {
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const r1 = verifyStripeWebhook({ signatureHeader: '', rawBody: '{}', env });
  assert.equal(r1.valid, false);
  assert.equal(r1.reason, 'missing-signature');

  const r2 = verifyStripeWebhook({ signatureHeader: 'invalid-header', rawBody: '{}', env });
  assert.equal(r2.valid, false);
  assert.equal(r2.reason, 'malformed-signature-header');

  const r3 = verifyStripeWebhook({ signatureHeader: 't=notanumber,v1=sig', rawBody: '{}', env });
  assert.equal(r3.valid, false);
  assert.equal(r3.reason, 'malformed-signature-header');
});

test('verifyStripeWebhook rejects timestamps outside tolerance window (replay attack prevention)', () => {
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const now = 1700000000;
  const staleTimestamp = now - 600; // 10 minutes old (> 300s tolerance)
  const payload = '{"id":"evt_replay"}';
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${staleTimestamp}.${payload}`).digest('hex');

  const result = verifyStripeWebhook({
    signatureHeader: `t=${staleTimestamp},v1=${sig}`,
    rawBody: payload,
    env,
    toleranceSeconds: 300,
    nowTimestamp: now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'timestamp-outside-tolerance');
});

test('verifyStripeWebhook rejects forged or mismatched signatures', () => {
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const now = 1700000000;
  const payload = '{"id":"evt_tampered"}';
  const forgedSig = crypto.createHmac('sha256', 'wrong_secret').update(`${now}.${payload}`).digest('hex');

  const result = verifyStripeWebhook({
    signatureHeader: `t=${now},v1=${forgedSig}`,
    rawBody: payload,
    env,
    nowTimestamp: now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature-mismatch');
});

test('verifyStripeWebhook accepts valid HMAC-SHA256 signature and returns parsed event', () => {
  const env = { STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const now = 1700000000;
  const payload = JSON.stringify({ id: 'evt_valid_123', type: 'checkout.session.completed' });
  const validSig = crypto.createHmac('sha256', 'whsec_test').update(`${now}.${payload}`).digest('hex');

  const result = verifyStripeWebhook({
    signatureHeader: `t=${now},v1=${validSig}`,
    rawBody: payload,
    env,
    nowTimestamp: now,
  });
  assert.equal(result.configured, true);
  assert.equal(result.valid, true);
  assert.equal(result.status, 200);
  assert.equal(result.event.id, 'evt_valid_123');
  assert.equal(result.event.type, 'checkout.session.completed');
});

test('stripe webhook route does not issue operator tokens or fake paid permissions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app/api/webhooks/stripe/route.ts'), 'utf8');
  assert.match(source, /verifyStripeWebhook/);
  assert.doesNotMatch(source, /issueWorkspaceSession|SCRAPER_ADMIN_TOKEN|paid:\s*true/);
});
