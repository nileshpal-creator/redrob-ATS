import "dotenv/config";

/**
 * Single source of truth for the dedicated test database's connection
 * string. vitest.config.mts (which overrides process.env.DATABASE_URL for
 * every test worker) and global-setup.ts (which runs migrations against it
 * before the suite starts) both import this instead of each hardcoding
 * their own copy of the URL — a literal duplicated across two files is
 * exactly how they silently drift and end up authenticating with different
 * credentials. Throws instead of falling back to a default so a missing
 * TEST_DATABASE_URL fails loudly at config-load time, not several layers
 * deep as a cryptic Postgres authentication error.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Add it to .env (see .env.example) — " +
        "it must point at a dedicated test database, never at DATABASE_URL's.",
    );
  }
  return url;
}
