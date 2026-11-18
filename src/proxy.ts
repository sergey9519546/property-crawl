import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  buildContentSecurityPolicy,
  requestUsesHttps,
} from './lib/security/content-security-policy';
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  negotiateLocaleFromAcceptLanguage,
  normalizeLocale,
} from './lib/i18n/config';

/**
 * Per-request CSP nonce + locale negotiation. Next applies the CSP header to
 * framework scripts when x-nonce is present on the request. See next dist docs:
 * content-security-policy.
 *
 * upgrade-insecure-requests is set only when the request is already HTTPS.
 * Local `next start` is HTTP and must keep working.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const policy = buildContentSecurityPolicy({
    nonce,
    isDev,
    upgradeInsecureRequests: !isDev && requestUsesHttps(request),
  });

  const queryLocale = normalizeLocale(request.nextUrl.searchParams.get('lang'));
  const cookieLocale = normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  const locale = queryLocale ?? cookieLocale ?? negotiateLocaleFromAcceptLanguage(request.headers.get('accept-language'));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  requestHeaders.set(LOCALE_HEADER, locale);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', policy);
  if (queryLocale && queryLocale !== cookieLocale) {
    response.cookies.set(LOCALE_COOKIE, queryLocale, {
      path: '/',
      maxAge: 31_536_000,
      sameSite: 'lax',
    });
  }
  return response;
}

export const middleware = proxy;

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

export default proxy;
