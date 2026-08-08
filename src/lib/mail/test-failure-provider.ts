import type { MailMessage, MailProvider, MailSendResult } from "./provider";

/**
 * Module 12 (scheduler infrastructure): every retry/permanent-failure path
 * this module adds (interview reminders, the scheduled-report claim fix)
 * needs a way to make a real send genuinely fail — `ConsoleMailProvider`
 * never does (see its own doc comment), so retry logic would otherwise be
 * unexercisable by any test in this codebase. Deliberately per-message
 * deterministic (fails only when the recipient address contains
 * `SIMULATED_FAILURE_MARKER`) rather than globally-always-failing, so a
 * single test file can drive both the success and the failure path through
 * the exact same provider instance without any module-cache reset — the
 * marker IS the test's input, not hidden state.
 *
 * The marker optionally carries a count, `simulate-mail-failure:N` — fail
 * the first N sends to that exact address, then succeed from the (N+1)th
 * on, so a retry-then-recovers test is possible without ever mutating
 * `toEmail` after it's frozen at claim time. No number (bare
 * `simulate-mail-failure`) means "always fail," for permanent-failure
 * testing. The per-address counter is ordinary module-level state, safe
 * here specifically because Vitest gives each test FILE its own isolated
 * module registry (see vitest.config.mts) — it never leaks across files,
 * and within one file it's exactly the shared state the test intends.
 *
 * `MAIL_PROVIDER=test_failure` is real, supported factory wiring (not a
 * mock swapped in via a test framework) so the retry/backoff/permanent-
 * failure logic in src/lib/services/interview-reminders.ts and
 * src/lib/services/scheduled-reports.ts is tested against the same
 * MailProvider interface production code calls — never a special-cased
 * test seam bypassing it.
 */
export const SIMULATED_FAILURE_MARKER = "simulate-mail-failure";
const FAILURE_PATTERN = /simulate-mail-failure(?::(\d+))?/;

export class TestFailureMailProvider implements MailProvider {
  private attemptsByAddress = new Map<string, number>();

  async send(message: MailMessage): Promise<MailSendResult> {
    const match = FAILURE_PATTERN.exec(message.to);
    if (!match) {
      return { success: true };
    }

    const failCount = match[1] ? Number(match[1]) : Infinity;
    const attemptNumber = (this.attemptsByAddress.get(message.to) ?? 0) + 1;
    this.attemptsByAddress.set(message.to, attemptNumber);

    if (attemptNumber <= failCount) {
      return { success: false, errorMessage: `Simulated failure (attempt ${attemptNumber}).` };
    }
    return { success: true };
  }
}
