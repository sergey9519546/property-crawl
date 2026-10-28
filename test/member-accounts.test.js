'use strict';

// Paid member accounts: magic-link tokens, Stripe subscription state as the
// entitlement, and per-account scoping of hunts and watchlists in the API.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-accounts-'));
process.env.NODE_ENV = 'test';
process.env.PROPERTY_HUNTS_PATH = path.join(dir, 'hunts.json');
process.env.PROPERTY_ACCOUNTS_PATH = path.join(dir, 'accounts.json');
const TOKEN = 'member-test-operator-token';
process.env.SCRAPER_ADMIN_TOKEN = TOKEN;

const server = require('../server/server');
const { createAccountService, createFileBackend, isEntitled } = require('../server/accounts/store');
const { createCheckoutSession, subscriptionState } = require('../server/billing/stripe-checkout');

let baseUrl;
function call(method, pathname, { token = TOKEN, account, body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, baseUrl), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(account ? { 'x-pp-account': account } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  resolve();
})));
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signUp(email) {
  const issued = await call('POST', '/api/accounts/login-token', { body: { email } });
  assert.equal(issued.status, 201);
  const consumed = await call('POST', '/api/accounts/consume', { body: { token: issued.body.token } });
  assert.equal(consumed.status, 200);
  return { account: consumed.body.account, token: issued.body.token };
}

test('magic-link tokens create the account once and cannot be replayed', async () => {
  const { account, token } = await signUp('Buyer@Example.com');
  assert.match(account.id, /^acct_[a-f0-9]{24}$/);
  assert.equal(account.email, 'buyer@example.com');
  assert.equal(account.entitled, false);
  const replay = await call('POST', '/api/accounts/consume', { body: { token } });
  assert.equal(replay.status, 401);
  const again = await signUp('buyer@example.com');
  assert.equal(again.account.id, account.id, 'same email signs into the same account');
});

test('account API needs the operator token and refuses member-scoped calls', async () => {
  assert.equal((await call('POST', '/api/accounts/login-token', { token: null, body: { email: 'a@b.co' } })).status, 401);
  assert.equal((await call('POST', '/api/accounts/login-token', { account: 'acct_000000000000000000000000', body: { email: 'a@b.co' } })).status, 401);
});

test('Stripe subscription state is the entitlement', async () => {
  const { account } = await signUp('payer@example.com');
  const future = Math.floor(Date.now() / 1000) + 86400;
  const linked = await call('POST', `/api/accounts/${account.id}/customer`, { body: { customerId: 'cus_ABC123' } });
  assert.equal(linked.body.account.stripeCustomerId, 'cus_ABC123');
  const active = await call('POST', '/api/accounts/subscription', { body: { customerId: 'cus_ABC123', subscriptionId: 'sub_1', status: 'active', currentPeriodEnd: future } });
  assert.equal(active.body.account.entitled, true);
  const canceled = await call('POST', '/api/accounts/subscription', { body: { customerId: 'cus_ABC123', status: 'canceled', currentPeriodEnd: future } });
  assert.equal(canceled.body.account.entitled, false);
  const unknown = await call('POST', '/api/accounts/subscription', { body: { customerId: 'cus_NOBODY', status: 'active' } });
  assert.equal(unknown.status, 404);
  assert.equal(isEntitled({ subscriptionStatus: 'active', currentPeriodEnd: '2000-01-01T00:00:00Z' }), false, 'a lapsed period is not entitled');
});

test('first checkout webhook finds the account by client_reference_id', async () => {
  const backend = createFileBackend(path.join(dir, 'ref.json'));
  const service = createAccountService({ backend });
  const { token } = await service.issueLoginToken('ref@example.com');
  const account = await service.consumeLoginToken(token);
  const updated = await service.applySubscription({ accountId: account.id, customerId: 'cus_REF', subscriptionId: 'sub_9', status: 'trialing' });
  assert.equal(updated.entitled, true);
  assert.equal(updated.stripeCustomerId, 'cus_REF');
});

test('members only see their own hunts; the operator sees all', async () => {
  const a = (await signUp('hunter-a@example.com')).account.id;
  const b = (await signUp('hunter-b@example.com')).account.id;
  const criteria = { mode: 'all', rules: [{ field: 'state', operator: 'eq', value: 'NJ' }] };
  const created = await call('POST', '/api/hunts', { account: a, body: { name: 'A hunt', criteria, notifyEmail: 'hunter-a@example.com' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.hunt.owner, a);
  const id = created.body.hunt.id;
  assert.equal((await call('GET', '/api/hunts', { account: a })).body.items.length, 1);
  assert.equal((await call('GET', '/api/hunts', { account: b })).body.items.length, 0);
  assert.equal((await call('GET', `/api/hunts/${id}`, { account: b })).status, 404);
  assert.equal((await call('PATCH', `/api/hunts/${id}`, { account: b, body: { enabled: false } })).status, 404);
  assert.equal((await call('DELETE', `/api/hunts/${id}`, { account: b })).status, 404);
  assert.ok((await call('GET', '/api/hunts')).body.items.some((hunt) => hunt.id === id));
  assert.equal((await call('GET', '/api/hunts', { account: 'not-an-account' })).status, 400);
});

test('watchlists are scoped per account, and operator-only routes refuse members', async () => {
  const a = (await signUp('watch-a@example.com')).account.id;
  const b = (await signUp('watch-b@example.com')).account.id;
  const listings = (await call('GET', '/api/listings?limit=1', { token: null })).body.listings;
  assert.ok(listings.length, 'test inventory has a listing');
  assert.equal((await call('POST', '/api/alerts', { account: a, body: { listingId: listings[0].id } })).status, 201);
  const ids = (deals) => deals.map((deal) => (typeof deal === 'string' ? deal : deal.listingId || deal.id));
  assert.ok(ids((await call('GET', '/api/alerts', { account: a })).body.deals).includes(listings[0].id));
  assert.deepEqual(ids((await call('GET', '/api/alerts', { account: b })).body.deals), []);
  assert.equal((await call('GET', '/api/source-network/jobs', { account: a })).status, 403);
});

test('checkout is a subscription tied to the account and its Stripe customer', async () => {
  let sent;
  const result = await createCheckoutSession({
    successUrl: 'https://example.com/account?checkout=success',
    cancelUrl: 'https://example.com/account?checkout=cancelled',
    customerId: 'cus_X', accountId: 'acct_0123456789abcdef01234567',
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_ID: 'price_1' },
    fetchImpl: async (_url, init) => { sent = new URLSearchParams(String(init.body)); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) }; },
  });
  assert.equal(result.url, 'https://checkout.stripe.com/x');
  assert.equal(sent.get('mode'), 'subscription');
  assert.equal(sent.get('customer'), 'cus_X');
  assert.equal(sent.get('client_reference_id'), 'acct_0123456789abcdef01234567');
});

test('subscription state reads the period end from either Stripe API shape', () => {
  assert.equal(subscriptionState({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 100 }).currentPeriodEnd, 100);
  assert.equal(subscriptionState({ id: 'sub_1', customer: { id: 'cus_1' }, status: 'active', items: { data: [{ current_period_end: 200 }] } }).currentPeriodEnd, 200);
});

test('webhook events are deduplicated via idempotency ledger', async () => {
  const checkInitial = await call('GET', '/api/accounts/webhook-event/evt_test_123');
  assert.equal(checkInitial.status, 200);
  assert.equal(checkInitial.body.recorded, false);

  const recordFirst = await call('POST', '/api/accounts/webhook-event', { body: { id: 'evt_test_123', type: 'customer.subscription.updated' } });
  assert.equal(recordFirst.status, 200);
  assert.equal(recordFirst.body.duplicate, false);

  const checkAfter = await call('GET', '/api/accounts/webhook-event/evt_test_123');
  assert.equal(checkAfter.status, 200);
  assert.equal(checkAfter.body.recorded, true);

  const recordDuplicate = await call('POST', '/api/accounts/webhook-event', { body: { id: 'evt_test_123', type: 'customer.subscription.updated' } });
  assert.equal(recordDuplicate.status, 200);
  assert.equal(recordDuplicate.body.duplicate, true);

  const released = await call('DELETE', '/api/accounts/webhook-event/evt_test_123');
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);
  assert.equal((await call('GET', '/api/accounts/webhook-event/evt_test_123')).body.recorded, false);
  assert.equal((await call('POST', '/api/accounts/webhook-event', { body: { id: 'evt_test_123', type: 'customer.subscription.updated' } })).body.duplicate, false, 'a released event can be claimed again');
});
