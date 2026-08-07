import type { MailMessage, MailProvider, MailSendResult } from "./provider";

/**
 * The only implemented provider (Phase 1 decision, §12: a real Gmail/Outlook
 * API integration needs OAuth credentials not available in this
 * environment, out of scope for this pass) — mirrors LocalStorageProvider in
 * spirit: no real external system, "delivery" means writing the message
 * where an operator can see it happened, not a network call.
 *
 * Unlike StructuredExportProvider (src/lib/hris/structured-export-provider.ts),
 * this provider has no genuine failure condition to model: its only
 * plausible precondition — a non-empty recipient — is already guaranteed by
 * the caller (bulkEmailApplications skips candidates with no email before a
 * log row is ever created), so a defensive check here would be dead code.
 * `send()` always succeeds; `EmailLogStatus.FAILED` stays a real, reachable
 * branch in the calling code (written generically against this interface)
 * but is only ever set by a future real provider that can genuinely fail.
 */
export class ConsoleMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<MailSendResult> {
    const attachmentSummary = message.attachments?.length
      ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.fileName} (${attachment.contentType}, ${attachment.content.length} bytes)`).join(", ")}`
      : "";
    console.log(`[ConsoleMailProvider] To: ${message.to}\nSubject: ${message.subject}\n\n${message.body}${attachmentSummary}`);
    return { success: true };
  }
}
