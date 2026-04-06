/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@vercel/blob", "undici"],
  },
};

export default nextConfig;
