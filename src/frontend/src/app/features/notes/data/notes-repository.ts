import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { live } from '../../sync/local/live';
import { LocalDbService, LocalNote } from '../../sync/local/local-db';
import { enqueueDelete, enqueueUpsert, hasPendingOperations } from '../../sync/local/outbox';
import { Note, NoteOrganization, NoteSummary } from '../models/note.model';

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Where notes live now: the database on THIS device. Every write changes the local rows and queues the change
 * for the server in ONE transaction (all-or-nothing); nothing here waits for the network, so everything works
 * offline and instantly. The sync engine sends the queue later and brings other devices' changes in.
 */
@Injectable({ providedIn: 'root' })
export class NotesRepository {
  private readonly local = inject(LocalDbService);

  private toSummary = (n: LocalNote): NoteSummary => ({
    id: n.id,
    title: n.title,
    updatedAt: n.updatedAt,
    version: n.version,
    notebookId: n.notebookId,
    isPinned: n.isPinned,
    status: n.status,
    tagIds: n.tagIds,
  });

  /** Every note (no text), kept up to date by itself. */
  watchSummaries(): Observable<NoteSummary[]> {
    return live(() => this.local.db.notes.toArray()).pipe(map((rows) => rows.map(this.toSummary)));
  }

  /** One note with its text; emits undefined when it is (or becomes) missing. */
  watch(id: string): Observable<Note | undefined> {
    return live(() => this.read(id));
  }

  async get(id: string): Promise<Note | undefined> {
    return this.read(id);
  }

  private async read(id: string): Promise<Note | undefined> {
    const db = this.local.db;
    const [row, content] = await Promise.all([db.notes.get(id), db.contents.get(id)]);
    return row ? { ...row, content: content?.content ?? '' } : undefined;
  }

  /** Creates a note on this device. It gets its id here: no server is needed to name it. */
  async create(title: string, content: string, notebookId: string | null): Promise<Note> {
    const db = this.local.db;
    const now = new Date().toISOString();
    const row: LocalNote = {
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      version: 0, // never synchronized
      notebookId,
      isPinned: false,
      status: 'None',
      tagIds: [],
    };

    await db.transaction('rw', db.notes, db.contents, db.outbox, async () => {
      await db.notes.add(row);
      await db.contents.add({ id: row.id, content });
      await enqueueUpsert(db, 'note', row.id, { title, content, notebookId }, 0);
    });
    return { ...row, content };
  }

  /** Saves title and text. Only what really changed is queued. @returns false when the note does not exist. */
  async saveText(id: string, title: string, content: string): Promise<boolean> {
    const db = this.local.db;
    return db.transaction('rw', db.notes, db.contents, db.outbox, async () => {
      const row = await db.notes.get(id);
      if (!row) {
        return false;
      }
      const stored = await db.contents.get(id);
      const patch: Record<string, unknown> = {};
      if (title !== row.title) patch['title'] = title;
      if (content !== (stored?.content ?? '')) patch['content'] = content;
      if (Object.keys(patch).length === 0) {
        return true;
      }

      // "updatedAt" is the local clock until the server's answer replaces it.
      await db.notes.update(id, { title, updatedAt: new Date().toISOString() });
      await db.contents.put({ id, content });
      await enqueueUpsert(db, 'note', id, patch, row.version);
      return true;
    });
  }

  /** Notebook, pin, status and tags. Only the fields that changed are queued. */
  async updateOrganization(id: string, change: NoteOrganization): Promise<boolean> {
    const db = this.local.db;
    return db.transaction('rw', db.notes, db.outbox, async () => {
      const row = await db.notes.get(id);
      if (!row) {
        return false;
      }
      const patch: Record<string, unknown> = {};
      if (change.notebookId !== row.notebookId) patch['notebookId'] = change.notebookId;
      if (change.isPinned !== row.isPinned) patch['isPinned'] = change.isPinned;
      if (change.status !== row.status) patch['status'] = change.status;
      if (!sameSet(change.tagIds, row.tagIds)) patch['tagIds'] = change.tagIds;
      if (Object.keys(patch).length === 0) {
        return true;
      }

      await db.notes.update(id, {
        notebookId: change.notebookId,
        isPinned: change.isPinned,
        status: change.status,
        tagIds: change.tagIds,
      });
      await enqueueUpsert(db, 'note', id, patch, row.version);
      return true;
    });
  }

  /** Does this note have changes that have not reached the server yet? (A restore from the history must wait for them.) */
  hasUnsyncedChanges(id: string): Promise<boolean> {
    return hasPendingOperations(this.local.db, 'note', id);
  }

  /** Deletes the note here and queues the deletion (it lands in the server's trash). @returns false when missing. */
  async delete(id: string): Promise<boolean> {
    const db = this.local.db;
    return db.transaction('rw', db.notes, db.contents, db.outbox, async () => {
      const row = await db.notes.get(id);
      if (!row) {
        return false;
      }
      await db.notes.delete(id);
      await db.contents.delete(id);
      await enqueueDelete(db, 'note', id, row.version);
      return true;
    });
  }
}
