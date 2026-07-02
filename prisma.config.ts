import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Prisma 7 moved connection URLs out of the schema datasource block; the
  // migrate/introspect engines read them from here. The runtime client uses
  // the @prisma/adapter-pg driver adapter (see lib/db.ts) instead.
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: path.join("prisma", "migrations"),
    // --conditions=react-server neutralizes the `server-only` guard (same as
    // the worker) so the seed can share lib/ modules — notably the sample
    // on-chain leg helper, which pulls in env/log/stellar client (#45).
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
});
