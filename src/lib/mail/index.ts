import { ConsoleMailProvider } from "./console-provider";
import type { MailProvider } from "./provider";

export type { MailMessage, MailProvider, MailSendResult } from "./provider";

let cached: MailProvider | null = null;

/**
 * Only "console" is implemented (same "one provider behind the interface,
 * MAIL_PROVIDER exists now so a future real connector doesn't require
 * touching every call site" decision as getStorageProvider/getHrisProvider).
 */
export function getMailProvider(): MailProvider {
  if (!cached) {
    const kind = process.env.MAIL_PROVIDER ?? "console";
    if (kind !== "console") {
      throw new Error(`Unsupported MAIL_PROVIDER "${kind}" — only "console" is implemented.`);
    }
    cached = new ConsoleMailProvider();
  }
  return cached;
}
