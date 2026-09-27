import type { NextRequest } from 'next/server';
import { proxy } from './src/proxy';

// Per-request nonce CSP middleware.
// Wires the handler from src/proxy.ts so that every navigation gets a fresh
// nonce for script-src (no 'unsafe-inline' for scripts) + strict-dynamic.
export function middleware(request: NextRequest) {
  return proxy(request);
}

// IMPORTANT: The matcher must be a top-level const with a static object literal
// so Next.js can statically analyze it at compile time. Re-exporting `config`
// from another module is not allowed and produces the "can't recognize the
// exported `config` field" error.
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
