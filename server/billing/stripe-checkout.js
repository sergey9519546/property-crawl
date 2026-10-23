'use strict';

function checkoutConfigured(env = process.env) {
  return Boolean(String(env.STRIPE_SECRET_KEY || '').trim() && String(env.STRIPE_PRICE_ID || '').trim());
}

function absoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

// One small Stripe REST helper; form-encoded body, bounded timeout.
async function stripeRequest(path, { method = 'POST', params, env = process.env, fetchImpl = fetch } = {}) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return { ok: false, status: 503, reason: 'not-configured' };
  let response;
  try {
    response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(params ? { body: new URLSearchParams(params) } : {}),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, status: 502, reason: 'stripe-unreachable' };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: 502, reason: `http-${response.status}`, payload };
  return { ok: true, status: 200, payload };
}

/**
 * Create a subscription Checkout Session for one member account. The account
 * id rides along as client_reference_id and subscription metadata so the
 * webhook can attach the subscription to the right account.
 */
async function createCheckoutSession({ successUrl, cancelUrl, customerId, accountId, env = process.env, fetchImpl = fetch }) {
  const price = String(env.STRIPE_PRICE_ID || '').trim();
  if (!checkoutConfigured(env)) return { configured: false, url: null, status: 503 };
  const success = absoluteHttpUrl(successUrl);
  const cancel = absoluteHttpUrl(cancelUrl);
  if (!success || !cancel) return { configured: true, url: null, status: 400, reason: 'invalid-return-url' };
  const params = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: success,
    cancel_url: cancel,
  };
  if (customerId) params.customer = customerId;
  if (accountId) {
    params.client_reference_id = accountId;
    params['subscription_data[metadata][account_id]'] = accountId;
  }
  const result = await stripeRequest('checkout/sessions', { params, env, fetchImpl });
  if (!result.ok) return { configured: true, url: null, status: 502, reason: result.reason };
  const url = result.payload?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return { configured: true, url: null, status: 502, reason: 'stripe-missing-url' };
  }
  return { configured: true, url, status: 200 };
}

async function createCustomer({ email, accountId, env = process.env, fetchImpl = fetch }) {
  const result = await stripeRequest('customers', { params: { email, 'metadata[account_id]': accountId }, env, fetchImpl });
  return result.ok && /^cus_/.test(result.payload?.id || '') ? result.payload.id : null;
}

async function createPortalSession({ customerId, returnUrl, env = process.env, fetchImpl = fetch }) {
  const back = absoluteHttpUrl(returnUrl);
  if (!back) return null;
  const result = await stripeRequest('billing_portal/sessions', { params: { customer: customerId, return_url: back }, env, fetchImpl });
  return result.ok && typeof result.payload?.url === 'string' ? result.payload.url : null;
}

async function getPrice({ env = process.env, fetchImpl = fetch } = {}) {
  const price = String(env.STRIPE_PRICE_ID || '').trim();
  if (!price) return null;
  const result = await stripeRequest(`prices/${encodeURIComponent(price)}`, { method: 'GET', env, fetchImpl });
  if (!result.ok) return null;
  const p = result.payload || {};
  return {
    unitAmount: Number.isFinite(p.unit_amount) ? p.unit_amount : null,
    currency: typeof p.currency === 'string' ? p.currency : null,
    interval: p.recurring?.interval || null,
  };
}

async function getSubscription(id, { env = process.env, fetchImpl = fetch } = {}) {
  if (!/^sub_[A-Za-z0-9]+$/.test(id || '')) return null;
  const result = await stripeRequest(`subscriptions/${id}`, { method: 'GET', env, fetchImpl });
  return result.ok ? result.payload : null;
}

// Newer Stripe API versions moved current_period_end onto subscription items.
function subscriptionState(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;
  const periodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return {
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: Number.isFinite(periodEnd) ? periodEnd : null,
    accountId: subscription.metadata?.account_id || null,
  };
}

const crypto = require('node:crypto');

function stripeWebhookConfigured(env = process.env) {
  return Boolean(String(env.STRIPE_WEBHOOK_SECRET || '').trim());
}

/**
 * Verify Stripe webhook signature (v1 scheme).
 * Rejects forged signatures, malformed headers, and timestamps outside tolerance.
 */
function verifyStripeWebhook({
  signatureHeader,
  rawBody,
  env = process.env,
  toleranceSeconds = 300,
  nowTimestamp = Math.floor(Date.now() / 1000),
}) {
  const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    return { configured: false, valid: false, status: 503, reason: 'webhook-not-configured' };
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) {
    return { configured: true, valid: false, status: 400, reason: 'missing-signature' };
  }
  if (typeof rawBody !== 'string') {
    return { configured: true, valid: false, status: 400, reason: 'invalid-body' };
  }

  const pairs = signatureHeader.split(',').map((p) => p.trim());
  let timestamp = null;
  const signatures = [];

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key === 't') {
      const parsed = Number.parseInt(val, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        timestamp = parsed;
      }
    } else if (key === 'v1') {
      if (val) signatures.push(val);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return { configured: true, valid: false, status: 400, reason: 'malformed-signature-header' };
  }

  if (Math.abs(nowTimestamp - timestamp) > toleranceSeconds) {
    return { configured: true, valid: false, status: 400, reason: 'timestamp-outside-tolerance' };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  let signatureValid = false;
  for (const sig of signatures) {
    const candidateBuffer = Buffer.from(sig, 'utf8');
    if (
      candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
    ) {
      signatureValid = true;
      break;
    }
  }

  if (!signatureValid) {
    return { configured: true, valid: false, status: 400, reason: 'signature-mismatch' };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { configured: true, valid: false, status: 400, reason: 'invalid-json' };
  }

  return { configured: true, valid: true, status: 200, event };
}

module.exports = {
  checkoutConfigured,
  createCheckoutSession,
  createCustomer,
  createPortalSession,
  getPrice,
  getSubscription,
  subscriptionState,
  verifyStripeWebhook,
  stripeWebhookConfigured,
};
