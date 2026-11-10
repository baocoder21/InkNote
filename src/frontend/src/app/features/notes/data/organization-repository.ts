import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { live } from '../../sync/local/live';
import { LocalDbService, LocalNotebook, LocalTag } from '../../sync/local/local-db';
import { enqueueDelete, enqueueUpsert } from '../../sync/local/outbox';
import { Notebook, Tag } from '../models/organization.model';

export type RepositoryDeleteResult = 'ok' | 'not-found' | 'not-empty';
export type RepositoryTagResult = { status: 'ok'; tag: Tag } | { status: 'duplicate' };

/** Notebooks and tags on THIS device (see NotesRepository: same idea, same guarantees). */
@Injectable({ providedIn: 'root' })
export class OrganizationRepository {
  private readonly local = inject(LocalDbService);

  private toNotebook = (n: LocalNotebook): Notebook => ({ id: n.id, name: n.name, parentId: n.parentId });
  private toTag = (t: LocalTag): Tag => ({ id: t.id, name: t.name });

  watchNotebooks(): Observable<Notebook[]> {
    return live(() => this.local.db.notebooks.toArray()).pipe(map((rows) => rows.map(this.toNotebook)));
  }

  watchTags(): Observable<Tag[]> {
    return live(() => this.local.db.tags.toArray()).pipe(map((rows) => rows.map(this.toTag)));
  }

  async createNotebook(name: string, parentId: string | null): Promise<Notebook> {
    const db = this.local.db;
    const row: LocalNotebook = { id: crypto.randomUUID(), name, parentId, version: 0 };
    await db.transaction('rw', db.notebooks, db.outbox, async () => {
      await db.notebooks.add(row);
      await enqueueUpsert(db, 'notebook', row.id, { name, parentId }, 0);
    });
    return this.toNotebook(row);
  }

  /** @returns false when the notebook does not exist. */
  async renameNotebook(id: string, name: string): Promise<boolean> {
    const db = this.local.db;
    return db.transaction('rw', db.notebooks, db.outbox, async () => {
      const row = await db.notebooks.get(id);
      if (!row) {
        return false;
      }
      if (row.name !== name) {
        await db.notebooks.update(id, { name });
        await enqueueUpsert(db, 'notebook', id, { name }, row.version);
      }
      return true;
    });
  }

  /** A notebook that still holds notes or sub-notebooks is not deleted (same rule as on the server). */
  async deleteNotebook(id: string): Promise<RepositoryDeleteResult> {
    const db = this.local.db;
    return db.transaction('rw', db.notebooks, db.notes, db.outbox, async () => {
      const row = await db.notebooks.get(id);
      if (!row) {
        return 'not-found';
      }
      if ((await db.notebooks.where('parentId').equals(id).count()) > 0 || (await db.notes.where('notebookId').equals(id).count()) > 0) {
        return 'not-empty';
      }
      await db.notebooks.delete(id);
      await enqueueDelete(db, 'notebook', id, row.version);
      return 'ok';
    });
  }

  /** Creates a tag unless one with the same name (ignoring case) exists. */
  async createTag(name: string): Promise<RepositoryTagResult> {
    const db = this.local.db;
    const wanted = name.trim().toLowerCase();
    return db.transaction('rw', db.tags, db.outbox, async () => {
      if ((await db.tags.toArray()).some((t) => t.name.trim().toLowerCase() === wanted)) {
        return { status: 'duplicate' } as const;
      }
      const row: LocalTag = { id: crypto.randomUUID(), name: name.trim(), version: 0 };
      await db.tags.add(row);
      await enqueueUpsert(db, 'tag', row.id, { name: row.name }, 0);
      return { status: 'ok', tag: this.toTag(row) } as const;
    });
  }

  /**
   * Deletes the tag and removes it from the notes that have it. The notes are changed on this device only (no
   * operation queued for them): the server removes the tag from its notes by itself when it deletes the tag.
   * @returns false when the tag does not exist.
   */
  async deleteTag(id: string): Promise<boolean> {
    const db = this.local.db;
    return db.transaction('rw', db.tags, db.notes, db.outbox, async () => {
      const row = await db.tags.get(id);
      if (!row) {
        return false;
      }
      await db.tags.delete(id);
      await db.notes.filter((n) => n.tagIds.includes(id)).modify((n) => {
        n.tagIds = n.tagIds.filter((t) => t !== id);
      });
      await enqueueDelete(db, 'tag', id, row.version);
      return true;
    });
  }
}
