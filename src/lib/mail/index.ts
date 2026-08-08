import { ConsoleMailProvider } from "./console-provider";
import { TestFailureMailProvider } from "./test-failure-provider";
import type { MailProvider } from "./provider";

export type { MailMessage, MailProvider, MailSendResult } from "./provider";
export { SIMULATED_FAILURE_MARKER } from "./test-failure-provider";

let cached: MailProvider | null = null;

/**
 * "console" (default) or "test_failure" (Module 12 — see
 * test-failure-provider.ts's own doc comment; deliberately never the
 * default, and refused outright under NODE_ENV=production so a
 * misconfigured deploy can't silently fail every real send).
 */
export function getMailProvider(): MailProvider {
  if (!cached) {
    const kind = process.env.MAIL_PROVIDER ?? "console";
    if (kind === "test_failure" && process.env.NODE_ENV === "production") {
      throw new Error('MAIL_PROVIDER=test_failure is not permitted when NODE_ENV=production.');
    }
    if (kind === "test_failure") {
      cached = new TestFailureMailProvider();
    } else if (kind === "console") {
      cached = new ConsoleMailProvider();
    } else {
      throw new Error(`Unsupported MAIL_PROVIDER "${kind}" — only "console"/"test_failure" are implemented.`);
    }
  }
  return cached;
}
