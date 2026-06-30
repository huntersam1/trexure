import { defineConfig } from "vitest/config";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv();

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // Co-located unit tests (lib/**, app/**, middleware.test.ts) plus the
    // integration suites under test/ and tests/.
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "lib/generated/**", "**/dist/**"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
