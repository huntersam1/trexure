#!/usr/bin/env node
/**
 * Guarded database reset for local demos: drop → re-migrate → reseed in one
 * command (`pnpm db:reset`). `prisma migrate reset` runs the configured seed
 * automatically, so this repopulates the full rich demo dataset (prisma/seed.ts).
 *
 * DESTRUCTIVE. Refuses to run when NODE_ENV=production unless explicitly forced
 * with ALLOW_DB_RESET=true (or `--force`), so a stray invocation can't wipe a
 * production database.
 */
import { execSync } from "node:child_process";

const isProd = process.env.NODE_ENV === "production";
const forced = process.env.ALLOW_DB_RESET === "true" || process.argv.includes("--force");

if (isProd && !forced) {
  console.error(
    "\x1b[31m✖ Refusing to reset the database with NODE_ENV=production.\x1b[0m\n" +
      "  This DROPS ALL DATA. If you really mean it, set ALLOW_DB_RESET=true or pass --force.",
  );
  process.exit(1);
}

const target = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@")
  : "(DATABASE_URL unset)";

console.log("\x1b[33m⚠ Resetting database (drop → migrate → seed)\x1b[0m");
console.log(`  target: ${target}`);
console.log(`  NODE_ENV: ${process.env.NODE_ENV ?? "(unset)"}${forced ? "  [forced]" : ""}`);

try {
  // `migrate reset --force` drops the schema, re-applies all migrations, then
  // runs the seed command from prisma.config.ts.
  execSync("pnpm exec prisma migrate reset --force", { stdio: "inherit" });
  console.log("\x1b[32m✔ Database reset + reseeded.\x1b[0m");
} catch (err) {
  console.error("\x1b[31m✖ Database reset failed.\x1b[0m", err?.message ?? err);
  process.exit(1);
}
