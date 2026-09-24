/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // WaveSurfer & Mermaid lifecycle works better without double-mount in dev
  experimental: {
    serverActions: {
      bodySizeLimit: '300mb'
    }
  }
};

export default nextConfig;
