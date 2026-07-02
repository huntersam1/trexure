import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "argon2",
    "pg",
    "@prisma/adapter-pg",
    "pino",
    "pino-http",
    "pdfkit",
    "snarkjs",
  ],
  typedRoutes: true,
  // Keep dev-mode screen recordings (pnpm demo:record) free of the floating
  // dev-tools button; has no effect on production builds.
  devIndicators: false,
};

export default nextConfig;
