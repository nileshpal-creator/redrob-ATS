import { StructuredExportProvider } from "./structured-export-provider";
import type { HrisProvider } from "./provider";

export type { HandoffPayload, HrisProvider, HrisPushResult } from "./provider";

let cached: HrisProvider | null = null;

/**
 * Only "structured_export" is implemented (same "one provider behind the
 * interface, HRIS_PROVIDER exists now so a future real connector doesn't
 * require touching every call site" decision as getStorageProvider).
 */
export function getHrisProvider(): HrisProvider {
  if (!cached) {
    const kind = process.env.HRIS_PROVIDER ?? "structured_export";
    if (kind !== "structured_export") {
      throw new Error(`Unsupported HRIS_PROVIDER "${kind}" — only "structured_export" is implemented.`);
    }
    cached = new StructuredExportProvider();
  }
  return cached;
}
