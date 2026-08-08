/**
 * Job board posting abstraction (§11.3 / §12: "Major job boards... matching
 * Zimyo's 50+ board reach"). Business logic (src/lib/services/
 * job-postings.ts) only ever talks to this interface — wiring up a real
 * board's API later means writing one new implementation of it, not
 * touching any service code. Same shape as MailProvider/HrisProvider/
 * StorageProvider.
 *
 * Deliberately scoped to the *outbound* side only (post/remove a listing) —
 * there is no `fetchInboundApplications` or webhook-receiver method here.
 * Real board integrations vary wildly in how they deliver inbound
 * applications back (webhook push, polling API, email digest); modeling one
 * specific shape here without a real board to validate it against would be
 * inventing a requirement the PRD doesn't state. Inbound applications are
 * received through `receiveInboundApplication` in job-postings.ts instead —
 * a plain, provider-agnostic entry point any future real integration's own
 * webhook handler or polling adapter can call, authenticated the normal way
 * (a staff session), not a new unauthenticated route class.
 */
export type JobBoardTarget = {
  jobId: string;
  title: string;
  description: string | null;
};

export type JobBoardPostResult = {
  success: boolean;
  externalPostingId?: string;
  errorMessage?: string;
};

export type JobBoardRemoveResult = {
  success: boolean;
  errorMessage?: string;
};

export interface JobBoardProvider {
  post(job: JobBoardTarget): Promise<JobBoardPostResult>;
  remove(externalPostingId: string): Promise<JobBoardRemoveResult>;
}
