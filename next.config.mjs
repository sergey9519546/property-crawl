/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the Base44 preview origin (served through a proxy hostname that
  // changes whenever the environment is recreated) to reach dev assets/HMR.
  allowedDevOrigins: process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [`https://3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`, `3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`]
    : [],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.jsdelivr.net' },
      { protocol: 'https', hostname: 'cdn.prod.website-files.com' }
    ]
  }
};

export default nextConfig;
