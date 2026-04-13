/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@vercel/blob", "undici", "@node-rs/bcrypt"],
  },
};

export default nextConfig;
