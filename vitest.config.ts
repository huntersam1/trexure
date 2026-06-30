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
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
