import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests run against a dedicated `ats_test` database — never the dev DB.
// See tests/setup/global-setup.ts for how it's migrated before the suite runs.
const TEST_DATABASE_URL = "postgresql://ats:ats@localhost:5432/ats_test?schema=public";

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
  },
});
