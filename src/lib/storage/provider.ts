/**
 * Storage abstraction for candidate document attachments (§11.2). Business
 * logic (src/lib/services/candidates.ts) only ever talks to this interface —
 * swapping the local filesystem for S3 or another provider later means
 * writing one new implementation of it, not touching any service code.
 */
export interface StorageProvider {
  save(input: {
    candidateId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
