import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LocalDbService } from '../../sync/local/local-db';
import { AttachmentRepository } from '../data/attachment-repository';
import { isImageType } from '../models/attachment.model';
import { AttachmentsApi } from './attachments-api.service';

export interface ResolvedAttachment {
  /** Where the browser can load it from: a blob: address (this device) or a short-lived address of the storage. */
  url: string;
  name: string;
  isImage: boolean;
}

/**
 * Finds out where to show an attached file from. The Markdown only says  attachment:<id>;  what that means depends on
 * the device:
 *  1. the file is in this device's database (the user added it here, or it was seen before): shown from there, at
 *     once, offline too;
 *  2. otherwise the server is asked for a short-lived address (a presigned URL). The bytes are then downloaded and kept
 *     on this device, so the next time (offline too) step 1 answers. If the download itself is not possible (the
 *     storage forbids this page to read it), the address is used as it is and the file simply is not kept.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentResolver {
  private readonly local = inject(LocalDbService);
  private readonly repository = inject(AttachmentRepository);
  private readonly api = inject(AttachmentsApi);

  private readonly resolved = new Map<string, ResolvedAttachment>();
  private readonly pending = new Map<string, Promise<ResolvedAttachment | null>>();
  private readonly objectUrls = new Set<string>();

  /** What is already known, without waiting: lets the preview put the address on an image the moment it is drawn. */
  known(id: string): ResolvedAttachment | null {
    return this.resolved.get(id) ?? null;
  }

  /** null = it cannot be shown now (not here, and the server cannot be reached or does not know it). */
  resolve(id: string): Promise<ResolvedAttachment | null> {
    const known = this.resolved.get(id);
    if (known) {
      return Promise.resolve(known);
    }
    // Several places asking for the same file at once (the same image twice in a note) share one answer.
    let running = this.pending.get(id);
    if (!running) {
      running = this.find(id).finally(() => this.pending.delete(id));
      this.pending.set(id, running);
    }
    return running;
  }

  /**
   * Saves the file, or opens it in a new tab for the browser to save it (a PDF, a text file...).
   * @returns false when the file is not on this device and the server cannot be asked.
   */
  async download(id: string): Promise<boolean> {
    const stored = this.local.isOpen ? await this.repository.blob(id) : undefined;
    if (stored) {
      this.save(this.objectUrl(stored.data, stored.type), stored.name);
      return true;
    }
    try {
      const address = await firstValueFrom(this.api.url(id, true));
      this.save(address.url, address.fileName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The bytes of a file, for the export: from this device's copy, or downloaded from the server (and kept, like when a
   * file is shown). null when it is not here and the server cannot be reached.
   */
  async bytes(id: string): Promise<{ name: string; type: string; data: ArrayBuffer } | null> {
    const stored = this.local.isOpen ? await this.repository.blob(id) : undefined;
    if (stored) {
      return { name: stored.name, type: stored.type, data: stored.data };
    }
    try {
      const address = await firstValueFrom(this.api.url(id));
      const got = await this.fetchBytes(address.url);
      if (got === 'refused' || got === 'unreadable') {
        return null;
      }
      if (this.local.isOpen) {
        await this.repository.cache(id, address.fileName, address.contentType, got);
      }
      return { name: address.fileName, type: address.contentType, data: got };
    } catch {
      return null;
    }
  }

  /** Frees the addresses made for this user's files (sign-out, closing the database). */
  clear(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.resolved.clear();
    this.pending.clear();
  }

  private async find(id: string): Promise<ResolvedAttachment | null> {
    const stored = this.local.isOpen ? await this.repository.blob(id) : undefined;
    if (stored) {
      return this.remember(id, { url: this.objectUrl(stored.data, stored.type), name: stored.name, isImage: isImageType(stored.type) });
    }

    try {
      const address = await firstValueFrom(this.api.url(id));
      const shown: ResolvedAttachment = { url: address.url, name: address.fileName, isImage: address.isImage };
      const bytes = await this.fetchBytes(address.url);
      if (bytes === 'refused') {
        return null; // the storage says no (the address expired, the file is gone): there is nothing to show
      }
      if (bytes !== 'unreadable' && this.local.isOpen) {
        await this.repository.cache(id, address.fileName, address.contentType, bytes);
        // From now on it is shown from this device's own copy.
        return this.remember(id, { ...shown, url: this.objectUrl(bytes, address.contentType) });
      }
      // Not kept (the storage does not let this page READ it, which an <img> does not need): the address still shows the file, for as long as it lives.
      return shown;
    } catch {
      return null;
    }
  }

  /**
   * The bytes behind an address. 'refused' = the storage answered with an error; 'unreadable' = the browser would not let
   * this page read the answer (the storage sends no CORS permission: showing an image does not need it, reading it does).
   */
  private async fetchBytes(url: string): Promise<ArrayBuffer | 'refused' | 'unreadable'> {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      return response.ok ? await response.arrayBuffer() : 'refused';
    } catch {
      return 'unreadable';
    }
  }

  private remember(id: string, resolved: ResolvedAttachment): ResolvedAttachment {
    this.resolved.set(id, resolved);
    return resolved;
  }

  private objectUrl(data: ArrayBuffer, type: string): string {
    const url = URL.createObjectURL(new Blob([data], { type }));
    this.objectUrls.add(url);
    return url;
  }

  private save(url: string, name: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = name; // used for addresses of this origin (blob:); a storage address says its own name in its headers
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}
