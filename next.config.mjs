import { buildSecurityHeaders } from "./config/csp.mjs";

/** @type {import('next').NextConfig} */
const securityHeaders = buildSecurityHeaders();

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@vercel/blob", "undici", "@node-rs/bcrypt"],
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
