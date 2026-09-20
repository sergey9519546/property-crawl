/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
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
  // Canonical UI security headers (production). Align with the Node API.
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
      // style-src must allow Google Fonts CSS hosts used by src/app/layout.tsx.
      // script-src still needs 'unsafe-inline' for Next bootstrap (tracked residual).
      { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https: data:; connect-src 'self' https:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'self'" },
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
