import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  buildContentSecurityPolicy,
  requestUsesHttps,
} from './lib/security/content-security-policy';

/**
 * Per-request CSP nonce. Next applies it to framework scripts when this
 * header is present on the request. See next dist docs: content-security-policy.
 *
 * upgrade-insecure-requests is set only when the request is already HTTPS.
 * Local `next start` is HTTP and must keep working.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const policy = buildContentSecurityPolicy({
    nonce,
    isDev,
    upgradeInsecureRequests: !isDev && requestUsesHttps(request),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
