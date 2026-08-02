import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      // `server-only` throws by design outside a server bundle. Tests exercise
      // these modules directly, so it is stubbed rather than removed from the
      // source — the guard still protects real client bundles.
      "server-only": resolve(import.meta.dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite boots a WASM Postgres per suite; the default 5s is tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
