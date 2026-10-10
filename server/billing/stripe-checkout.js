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

module.exports = { checkoutConfigured, createCheckoutSession };
