/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  // Browser target is declared explicitly in package.json "browserslist".
  //
  // Recorded here because the measured outcome was NOT what it looks like, and
  // the next person to read this will assume it was:
  //
  //   * Next 16's own default is ALREADY Baseline (MODERN_BROWSERSLIST_TARGET in
  //     next/dist/shared/lib/constants.js: chrome/edge/firefox 111, safari 16.4).
  //     There was no conservative default to escape.
  //   * The ~14.4 kB legacy-JS polyfill chunk is emitted by Turbopack
  //     unconditionally and does not respond to the target. Probed with
  //     "ie 11": same chunk, same hash, same 112,594 bytes.
  //
  // So declaring the target moved 0 bytes, and the polyfill is not recoverable
  // from configuration. The value here is pinning the floor explicitly rather
  // than inheriting a framework default that could move under us.
  reactStrictMode: true,

  // Keep production verification separate from an active development server.
  distDir: process.env.NEXT_DISCOVERY_PREVIEW === '1' ? '.next-discovery-preview'
    : process.env.NEXT_VERIFY_BUILD === 'sources' ? '.next-sources-verify'
    : process.env.NEXT_VERIFY_BUILD === '1' ? '.next-verify' : '.next',
  experimental: {
    // Bound page-generation workers on high-core local machines with limited memory.
    cpus: 2,
    turbopackFileSystemCacheForBuild: !process.env.NEXT_VERIFY_BUILD,
  },
  // Allow the Base44 preview origin (served through a proxy hostname that
  // changes whenever the environment is recreated) to reach dev assets/HMR.
  // Fixed: ensure both entries have valid origin protocols (http + https).
  allowedDevOrigins: process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [
        `https://3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`,
        `http://3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`
      ]
    : [],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.jsdelivr.net' },
      { protocol: 'https', hostname: 'cdn.prod.website-files.com' }
    ]
  },
  // Security: do not advertise the framework in headers.
  poweredByHeader: false,
  // Canonical UI security headers (production). Document CSP is set per request
  // in src/proxy.ts so script-src can use a nonce instead of 'unsafe-inline'.
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      security.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
    }
    return [
      { source: '/(.*)', headers: security },
    ];
  },
  // @server/* is a runtime alias for ./server/* so Next.js components
  // can import canonical Node-side modules (not stubs under src/lib/scrapers/).
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@server': path.resolve(__dirname, 'server'),
    };
    return config;
  }
};

export default nextConfig;
