import { defineConfig } from "vitest/config";
import path from "node:path";
import { getTestDatabaseUrl } from "./tests/setup/test-database-url";

// Tests run against a dedicated test database (TEST_DATABASE_URL in .env) —
// never the dev DB. See tests/setup/test-database-url.ts for why this reads
// from one shared helper instead of a hardcoded literal, and
// tests/setup/global-setup.ts for how it's migrated before the suite runs.
const TEST_DATABASE_URL = getTestDatabaseUrl();

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globalSetup: ["./tests/setup/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
    testTimeout: 20000,
    hookTimeout: 30000,
    // Several test files independently create-then-tear-down the same
    // globally-unique ControlledList rows (DEPARTMENT, LOCATION,
    // REJECTION_REASON — Job/Application both validate against these exact
    // keys). That's only safe if files run one at a time; concurrent files
    // racing to own/delete the same unique key corrupts each other's fixtures.
    fileParallelism: false,
  },
});
