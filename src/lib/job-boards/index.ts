import { MockJobBoardProvider } from "./mock-provider";
import type { JobBoardProvider } from "./provider";

export type { JobBoardPostResult, JobBoardProvider, JobBoardRemoveResult, JobBoardTarget } from "./provider";

let cached: JobBoardProvider | null = null;

/**
 * Only "mock" is implemented (same "one provider behind the interface,
 * JOB_BOARD_PROVIDER exists now so a future real connector doesn't require
 * touching every call site" decision as getMailProvider/getHrisProvider/
 * getStorageProvider).
 */
export function getJobBoardProvider(): JobBoardProvider {
  if (!cached) {
    const kind = process.env.JOB_BOARD_PROVIDER ?? "mock";
    if (kind !== "mock") {
      throw new Error(`Unsupported JOB_BOARD_PROVIDER "${kind}" — only "mock" is implemented.`);
    }
    cached = new MockJobBoardProvider();
  }
  return cached;
}
