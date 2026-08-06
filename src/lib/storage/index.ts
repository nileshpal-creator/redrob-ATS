import { LocalStorageProvider } from "./local-provider";
import type { StorageProvider } from "./provider";

export type { StorageProvider } from "./provider";

let cached: StorageProvider | null = null;

/**
 * Only "local" is implemented (Phase 2 decision: local filesystem for
 * development, behind this abstraction so a future S3 provider is a new
 * file, not a business-logic change). STORAGE_PROVIDER exists now so that
 * future addition doesn't require touching every call site.
 */
export function getStorageProvider(): StorageProvider {
  if (!cached) {
    const kind = process.env.STORAGE_PROVIDER ?? "local";
    if (kind !== "local") {
      throw new Error(`Unsupported STORAGE_PROVIDER "${kind}" — only "local" is implemented.`);
    }
    cached = new LocalStorageProvider();
  }
  return cached;
}
