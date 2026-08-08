import type { JobBoardPostResult, JobBoardProvider, JobBoardRemoveResult, JobBoardTarget } from "./provider";

/**
 * The only implemented provider (Phase 1 decision, §12: real job-board API
 * integrations need per-board partner credentials not available in this
 * environment, out of scope for this pass) — lets §11.3 be fully exercised
 * end to end without one. Mirrors StructuredExportProvider
 * (src/lib/hris/structured-export-provider.ts) in spirit: no real external
 * system, but a genuine, non-trivial failure condition to exercise rather
 * than an unconditional success.
 *
 * A real board would plausibly reject a listing with no job description —
 * that's the one precondition this mock actually checks. `remove()` has no
 * comparably real failure condition of its own (removal is idempotent by
 * nature — "already gone" isn't a provider-level failure, it's a
 * service-layer state check on JobPosting.status), so it always succeeds.
 */
export class MockJobBoardProvider implements JobBoardProvider {
  async post(job: JobBoardTarget): Promise<JobBoardPostResult> {
    if (!job.description || job.description.trim().length === 0) {
      return {
        success: false,
        errorMessage: "This job has no description — add one before posting to a board.",
      };
    }

    return { success: true, externalPostingId: `mock-${job.jobId}-${Date.now()}` };
  }

  async remove(): Promise<JobBoardRemoveResult> {
    return { success: true };
  }
}
