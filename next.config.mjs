/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@vercel/blob", "undici", "@node-rs/bcrypt"],
};

export default nextConfig;
