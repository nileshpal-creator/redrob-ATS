import { execSync } from "node:child_process";

const TEST_DATABASE_URL = "postgresql://ats:ats@localhost:5432/ats_test?schema=public";

/** Applies every migration to the dedicated test database once before the suite runs. */
export default function globalSetup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
