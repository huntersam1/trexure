import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "argon2",
    "pg",
    "@prisma/adapter-pg",
    "pino",
    "pino-http",
  ],
  typedRoutes: true,
};

export default nextConfig;
