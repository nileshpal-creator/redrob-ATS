/**
 * HRIS delivery abstraction for the onboarding handoff (§11.7 / §12). Business
 * logic (src/lib/services/handoffs.ts) only ever talks to this interface —
 * wiring up a real HRIS's API later means writing one new implementation of
 * it, not touching any service code. Same shape as StorageProvider
 * (src/lib/storage/provider.ts).
 */
export type HandoffPayload = {
  candidate: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    location: string | null;
    currentCompensation: string | null;
    expectedCompensation: string | null;
    earliestAvailability: string | null;
  };
  offer: {
    id: string;
    compensation: string;
    expectedJoiningDate: string | null;
    notes: string | null;
  };
  job: {
    id: string;
    title: string;
  };
  documents: {
    id: string;
    fileName: string;
    documentType: string;
    uploadedAt: string;
  }[];
};

export type HrisPushResult = {
  success: boolean;
  externalReferenceId?: string;
  errorMessage?: string;
};

export interface HrisProvider {
  method: "API_PUSH" | "STRUCTURED_EXPORT";
  push(payload: HandoffPayload): Promise<HrisPushResult>;
}
