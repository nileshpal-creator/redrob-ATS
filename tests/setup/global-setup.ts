import { execSync } from "node:child_process";
import { getTestDatabaseUrl } from "./test-database-url";

/** Applies every migration to the dedicated test database once before the suite runs. */
export default function globalSetup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
  });
}
