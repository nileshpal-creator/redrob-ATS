import type { HandoffPayload, HrisProvider, HrisPushResult } from "./provider";

/**
 * The only implemented provider (Phase 1 decision, §12: real HRIS API
 * integrations are out of scope for this module) — mirrors LocalStorageProvider
 * in spirit: no real external system, the payload itself (already assembled
 * and stored on HandoffRecord.payload) *is* the deliverable, retrievable
 * through the existing API rather than pushed anywhere. "Delivery" here means
 * validating the package is complete enough to hand off, not a network call.
 *
 * A missing candidate email is treated as a delivery failure — a real HRIS
 * push would reject an onboarding record without one, and this gives the
 * retry/exception path something genuine (not simulated) to exercise.
 */
export class StructuredExportProvider implements HrisProvider {
  method: "API_PUSH" | "STRUCTURED_EXPORT" = "STRUCTURED_EXPORT";

  async push(payload: HandoffPayload): Promise<HrisPushResult> {
    if (!payload.candidate.email) {
      return {
        success: false,
        errorMessage: "Missing candidate email — required for the onboarding structured export.",
      };
    }

    return { success: true };
  }
}
