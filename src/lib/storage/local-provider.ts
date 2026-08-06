import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "./provider";

const ROOT = path.resolve(process.env.LOCAL_STORAGE_ROOT ?? "./storage/candidate-documents");

/** Strips anything but safe filename characters — storageKey ends up as part of a filesystem path. */
function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Development-only StorageProvider backed by the local filesystem. Never committed — see .gitignore. */
export class LocalStorageProvider implements StorageProvider {
  async save(input: {
    candidateId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ storageKey: string }> {
    const storageKey = path.join(
      input.candidateId,
      `${randomUUID()}-${sanitizeFileName(input.fileName)}`,
    );
    const fullPath = path.join(ROOT, storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.buffer);
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(path.join(ROOT, storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(path.join(ROOT, storageKey), { force: true });
  }
}
