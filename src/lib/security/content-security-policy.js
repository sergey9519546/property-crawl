'use strict';

/**
 * Document Content-Security-Policy for the Next UI.
 *
 * script-src does not use 'unsafe-inline'. Next reads the nonce from the
 * request CSP header and attaches it to framework scripts. Development still
 * needs 'unsafe-eval' for React debug stacks.
 *
 * style-src: production gates style ELEMENTS with the nonce (no
 * 'unsafe-inline'); development keeps 'unsafe-inline' because dev tooling
 * may inject style elements without a nonce. React's style *attributes*
 * (progress widths, motion transforms, data-driven colors) are covered by
 * `style-src-attr 'unsafe-inline'` in every environment. Browsers that do
 * not implement style-src-attr (Safari < 15.4) fall back to style-src; on
 * those, React inline styles degrade cosmetically in production — the
 * accepted trade-off for closing the style-element injection vector.
 *
 * upgrade-insecure-requests is opt-in. Local production boot is HTTP, and
 * forcing HTTPS there breaks asset loads.
 */

function buildContentSecurityPolicy({
  nonce,
  isDev = false,
  upgradeInsecureRequests = false,
} = {}) {
  if (!nonce || typeof nonce !== 'string') {
    throw new Error('CSP nonce is required');
  }
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) scriptSrc.push("'unsafe-eval'");
  const styleSrc = isDev
    ? "'self' 'unsafe-inline' https://fonts.googleapis.com"
    : `'self' 'nonce-${nonce}' https://fonts.googleapis.com`;

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${styleSrc}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com https: data:",
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function scriptSrcAllowsUnsafeInline(policy) {
  const match = String(policy).match(/(?:^|;)\s*script-src\s+([^;]+)/);
  if (!match) return false;
  return match[1].split(/\s+/).includes("'unsafe-inline'");
}

function requestUsesHttps(request) {
  const forwarded = request?.headers?.get?.('x-forwarded-proto');
  if (forwarded) {
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }
  const protocol = request?.nextUrl?.protocol || '';
  return protocol === 'https:';
}

module.exports = {
  buildContentSecurityPolicy,
  scriptSrcAllowsUnsafeInline,
  requestUsesHttps,
};
