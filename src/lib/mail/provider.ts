/**
 * Email delivery abstraction for the Communication Hub (§11.10 / §12).
 * Business logic (src/lib/services/applications.ts) only ever talks to this
 * interface — wiring up a real email provider (§12: "Email provider
 * (Gmail/Outlook API)") later means writing one new implementation of it,
 * not touching any service code. Same shape as StorageProvider
 * (src/lib/storage/provider.ts) and HrisProvider (src/lib/hris/provider.ts).
 */
export type MailMessage = {
  to: string;
  subject: string;
  body: string;
};

export type MailSendResult = {
  success: boolean;
  errorMessage?: string;
};

export interface MailProvider {
  send(message: MailMessage): Promise<MailSendResult>;
}
