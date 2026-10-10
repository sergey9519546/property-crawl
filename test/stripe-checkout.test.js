'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkoutConfigured, createCheckoutSession } = require('../server/billing/stripe-checkout');

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
