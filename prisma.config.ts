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
    seed: "tsx prisma/seed.ts",
  },
});
