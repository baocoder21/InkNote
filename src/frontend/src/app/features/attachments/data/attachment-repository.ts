import { Injectable, InjectionToken, inject } from '@angular/core';
import { LocalBlob, LocalDbService, LocalUpload } from '../../sync/local/local-db';
import { attachmentProblem, isImageType, typeOf } from '../models/attachment.model';

export type AddAttachmentResult =
  | { status: 'ok'; id: string; name: string; isImage: boolean }
  | { status: 'rejected'; reason: string };

/** Downloaded files are kept for offline use up to this much; the oldest go first. Files waiting to be uploaded never go. An injection token so tests can lower it. */
export const ATTACHMENT_CACHE_LIMIT_BYTES = new InjectionToken<number>('ATTACHMENT_CACHE_LIMIT_BYTES', {
  providedIn: 'root',
  factory: () => 100 * 1024 * 1024,
});

/** Reads the bytes of a file. (Older environments, such as the test one, have no Blob.arrayBuffer.) */
export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Everything the app keeps about attached files on this device. Like the other repositories it is the ONLY code that
 * touches these tables, and a file the user adds is written here FIRST (its bytes and a place in the upload queue, in
 * one transaction): it shows at once and is sent when there is a connection.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentRepository {
  private readonly local = inject(LocalDbService);
  private readonly cacheLimit = inject(ATTACHMENT_CACHE_LIMIT_BYTES);

  /** Stores a file the user added (pasted, dropped) and queues it for upload. */
  async add(noteId: string, file: File): Promise<AddAttachmentResult> {
    const problem = attachmentProblem(file);
    if (problem) {
      return { status: 'rejected', reason: problem };
    }

    const db = this.local.db;
    const id = crypto.randomUUID();
    const type = typeOf(file);
    try {
      const data = await readBytes(file);
      await db.transaction('rw', db.blobs, db.uploads, async () => {
        await db.blobs.put({ id, name: file.name, type, size: file.size, data, cachedAt: Date.now() });
        await db.uploads.put({ id, noteId, createdAt: Date.now(), attempts: 0 });
      });
    } catch (error) {
      // Dexie reports a full disk with its own error class (not a DOMException) that carries the standard name.
      if ((error as { name?: string } | null)?.name === 'QuotaExceededError') {
        return { status: 'rejected', reason: 'There is not enough space left in this browser to keep the file.' };
      }
      return { status: 'rejected', reason: 'The file could not be read.' };
    }
    return { status: 'ok', id, name: file.name, isImage: isImageType(type) };
  }

  blob(id: string): Promise<LocalBlob | undefined> {
    return this.local.db.blobs.get(id);
  }

  /** Keeps a file downloaded from the server, so that it can be shown offline later. */
  async cache(id: string, name: string, type: string, data: ArrayBuffer): Promise<void> {
    const db = this.local.db;
    await db.blobs.put({ id, name, type, size: data.byteLength, data, cachedAt: Date.now() });
    await this.prune(id);
  }

  /** The files waiting to be sent, oldest first. */
  uploads(): Promise<LocalUpload[]> {
    return this.local.db.uploads.toArray().then((rows) => rows.sort((a, b) => a.createdAt - b.createdAt));
  }

  /** Sent: it leaves the queue. Its bytes stay as a downloaded file (they are what this device shows). */
  async uploaded(id: string): Promise<void> {
    await this.local.db.uploads.delete(id);
  }

  /** The server could not take it this time (it is not a refusal): it stays in the queue. */
  async failed(id: string): Promise<void> {
    await this.local.db.uploads.where('id').equals(id).modify((upload) => void upload.attempts++);
  }

  /** The server refused it for good (or its note is gone): it leaves the queue AND this device, so nothing shows what the server never had. */
  async drop(id: string): Promise<void> {
    const db = this.local.db;
    await db.transaction('rw', db.blobs, db.uploads, async () => {
      await db.uploads.delete(id);
      await db.blobs.delete(id);
    });
  }

  /** Removes the oldest DOWNLOADED files while more than the limit is kept. `keep` (the file just stored, which is being shown) is never removed. */
  private async prune(keep: string): Promise<void> {
    const db = this.local.db;
    const waiting = new Set((await db.uploads.toCollection().primaryKeys()) as string[]);
    const rows = await db.blobs.orderBy('cachedAt').toArray(); // oldest first
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows) {
      if (total <= this.cacheLimit) {
        break;
      }
      if (!waiting.has(row.id) && row.id !== keep) {
        await db.blobs.delete(row.id);
        total -= row.size;
      }
    }
  }
}
