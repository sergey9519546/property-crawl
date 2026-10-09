// acknowledged-orphan: TypeScript helper module for Content-Security-Policy nonce generation and directive composition

import {
  buildContentSecurityPolicy as buildCspInternal,
  scriptSrcAllowsUnsafeInline as scriptSrcAllowsUnsafeInlineInternal,
  requestUsesHttps as requestUsesHttpsInternal,
} from './security/content-security-policy';

export interface CspOptions {
  nonce: string;
  isDev?: boolean;
  upgradeInsecureRequests?: boolean;
}

/**
 * Generates a cryptographically random, base64-encoded nonce.
 */
export function generateNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return Buffer.from(crypto.randomUUID()).toString('base64');
  }
  // Fallback for Node environments where crypto global might need require
  const nodeCrypto = require('node:crypto');
  return Buffer.from(nodeCrypto.randomUUID()).toString('base64');
}

/**
 * Builds the canonical Content-Security-Policy header value for the Next.js App Router.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  return buildCspInternal(options);
}

/**
 * Validates whether the given policy string contains 'unsafe-inline' in script-src.
 */
export function scriptSrcAllowsUnsafeInline(policy: string): boolean {
  return scriptSrcAllowsUnsafeInlineInternal(policy);
}

/**
 * Determines whether a request is arriving over HTTPS (accounting for trusted upstream proto).
 */
export function requestUsesHttps(request: any): boolean {
  return requestUsesHttpsInternal(request);
}
