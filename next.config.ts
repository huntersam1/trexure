import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise the framework via X-Powered-By (#143)
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
