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

/**
 * Create a Stripe Checkout Session only when both secrets are set.
 * Does not record a payment, create an account, or grant operator access.
 */
async function createCheckoutSession({ successUrl, cancelUrl, env = process.env, fetchImpl = fetch }) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  const price = String(env.STRIPE_PRICE_ID || '').trim();
  if (!key || !price) return { configured: false, url: null, status: 503 };
  const success = absoluteHttpUrl(successUrl);
  const cancel = absoluteHttpUrl(cancelUrl);
  if (!success || !cancel) return { configured: true, url: null, status: 400, reason: 'invalid-return-url' };
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: success,
    cancel_url: cancel,
  });
  let response;
  try {
    response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { configured: true, url: null, status: 502, reason: 'stripe-unreachable' };
  }
  if (!response.ok) return { configured: true, url: null, status: 502, reason: `http-${response.status}` };
  const payload = await response.json().catch(() => ({}));
  if (typeof payload.url !== 'string' || !payload.url.startsWith('https://')) {
    return { configured: true, url: null, status: 502, reason: 'stripe-missing-url' };
  }
  return { configured: true, url: payload.url, status: 200 };
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
  verifyStripeWebhook,
  stripeWebhookConfigured,
};
