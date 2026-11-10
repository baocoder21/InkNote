import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { Note } from '../notes/models/note.model';
import { Notebook, Tag } from '../notes/models/organization.model';
import { CURSOR_KEY, LocalDb, LocalDbService, LocalNote, OutboxOp } from './local/local-db';
import { live } from './local/live';
import { hasPendingOperations } from './local/outbox';
import { MAX_OPERATIONS_PER_PUSH, SyncChange, SyncOperation, SyncOperationResult } from './models/sync.model';
import { SyncApi } from './services/sync-api.service';

/** Pause after the last local change before the queue is sent. Injectable so that tests can shorten it. */
export const SYNC_DEBOUNCE_MS = new InjectionToken<number>('SYNC_DEBOUNCE_MS', { providedIn: 'root', factory: () => 1500 });
/** How often to look for changes made on other devices (0 = never; tests turn it off). */
export const SYNC_INTERVAL_MS = new InjectionToken<number>('SYNC_INTERVAL_MS', { providedIn: 'root', factory: () => 30_000 });

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

/** Something the user should be told about (the page shows it, then clears it). */
export interface SyncNotice {
  kind: 'conflict' | 'gone' | 'rejected';
  message: string;
}

/**
 * The background worker that keeps this device and the server in step.
 *
 *  PUSH: sends the outbox (the changes made here), a batch at a time, and applies the server's answers.
 *  PULL: asks "what changed since my cursor?" and applies it to the local database.
 *
 * It runs when the user stops typing, when the connection comes back, when the tab becomes visible again, and
 * every 30 seconds. Only one run happens at a time; a request that arrives meanwhile makes it run once more.
 *
 * The rule that keeps the user's work safe: a thing with changes still waiting in the outbox is NEVER
 * overwritten by what the server says about it (the server's answer to the push brings the merged result).
 */
@Injectable({ providedIn: 'root' })
export class SyncEngine {
  private readonly local = inject(LocalDbService);
  private readonly api = inject(SyncApi);
  private readonly document = inject(DOCUMENT);
  private readonly debounceMs = inject(SYNC_DEBOUNCE_MS);
  private readonly intervalMs = inject(SYNC_INTERVAL_MS);

  readonly state = signal<SyncState>('idle');
  /** How many changes wait to be sent. */
  readonly pending = signal(0);
  readonly lastSyncedAt = signal<Date | null>(null);
  /** Goes up whenever the server accepted changes from this device (other parts of the app refresh then). */
  readonly pushedCount = signal(0);
  /** true once a first complete pull has happened on this device (before that, "empty" may just mean "not downloaded yet"). */
  readonly initialSyncDone = signal(false);
  readonly notices = signal<SyncNotice[]>([]);

  private running: Promise<void> | null = null;
  private runAgain = false;
  // True between the browser's "offline" and "online" events.
  private browserOffline = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private pendingWatch: Subscription | null = null;
  private listeners: (() => void)[] = [];

  /** Starts watching: call it once the local database is open. */
  start(): void {
    this.stop();
    const view = this.document.defaultView;

    this.pendingWatch = live(() => this.local.db.outbox.count()).subscribe((count) => {
      const grew = count > this.pending();
      this.pending.set(count);
      if (grew) {
        this.requestSync(); // something new to send: after a short pause (the user may still be typing)
      }
    });

    if (view) {
      const on = (target: Window | Document, type: string, handler: () => void) => {
        target.addEventListener(type, handler);
        this.listeners.push(() => target.removeEventListener(type, handler));
      };
      on(view, 'online', () => {
        this.browserOffline = false;
        void this.syncNow();
      });
      on(view, 'offline', () => {
        this.browserOffline = true;
        this.state.set('offline');
      });
      on(this.document, 'visibilitychange', () => {
        if (this.document.visibilityState === 'visible') this.requestSync();
      });
    }
    if (this.intervalMs > 0) {
      this.intervalTimer = setInterval(() => {
        if (this.document.visibilityState !== 'hidden') void this.syncNow();
      }, this.intervalMs);
    }

    void this.syncNow(); // catch up right away
  }

  stop(): void {
    this.pendingWatch?.unsubscribe();
    this.pendingWatch = null;
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.debounceTimer = this.intervalTimer = null;
    this.pending.set(0);
    this.state.set('idle');
    this.browserOffline = false;
    this.initialSyncDone.set(false);
  }

  /** "Sync soon": waits for a pause in the changes first, so a burst of typing is sent once. */
  requestSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, this.debounceMs);
  }

  /** Runs a synchronization now. Never rejects: problems are reported through `state`. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.runAgain = true; // something changed while running: once more afterwards
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.runAgain) {
        this.runAgain = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  /** Clears the notices after the page has shown them. */
  clearNotices(): void {
    this.notices.set([]);
  }

  /** How many changes have not reached the server (for the "sign out?" warning). */
  async pendingCount(): Promise<number> {
    return this.local.isOpen ? this.local.db.outbox.count() : 0;
  }

  // ------------------------------------------------------------------

  private async run(): Promise<void> {
    if (!this.local.isOpen) {
      return;
    }
    if (this.document.defaultView?.navigator.onLine === false) {
      this.state.set('offline');
      return;
    }

    this.state.set('syncing');
    try {
      await this.push();
      await this.pull();
      this.lastSyncedAt.set(new Date());
      this.initialSyncDone.set(true);
      // The browser may have announced "offline" while this run was waiting for an answer that still arrived:
      // the announcement is newer than the answer, so it wins.
      this.state.set(this.browserOffline ? 'offline' : 'idle');
    } catch (error) {
      // status 0 = the request never reached a server (no network, server down): that is "offline", not a bug.
      const offline = this.browserOffline || (error instanceof HttpErrorResponse && error.status === 0);
      this.state.set(offline ? 'offline' : 'error');
    }
  }

  // ---------------- push ----------------

  private async push(): Promise<void> {
    for (;;) {
      if (!this.local.isOpen) return;
      const db = this.local.db;
      const batch = await this.nextBatch(db);
      if (batch.length === 0) {
        return;
      }

      // Freeze them BEFORE the network is touched: from now on the server may have seen them (see OutboxOp.attempted).
      await db.transaction('rw', db.outbox, async () => {
        for (const op of batch) await db.outbox.update(op.seq!, { attempted: true });
      });

      const response = await firstValueFrom(this.api.push(batch.map(toWire)));
      const answered = await this.applyResults(db, batch, response.results);
      if (answered === 0) {
        // Without this a server that answers nothing would make us send the same batch forever.
        throw new Error('The server did not answer any of the operations.');
      }
    }
  }

  /** The next operations to send: in order, one per thing, none that wait for an answer still to come. */
  private async nextBatch(db: LocalDb): Promise<OutboxOp[]> {
    const all = await db.outbox.orderBy('seq').toArray();
    const seen = new Set<string>();
    const batch: OutboxOp[] = [];
    for (const op of all) {
      const key = `${op.entity}:${op.id}`;
      if (seen.has(key)) continue; // a later operation on the same thing waits for the earlier one's answer
      seen.add(key);
      if (op.awaitsBase) continue;
      batch.push(op);
      if (batch.length >= MAX_OPERATIONS_PER_PUSH) break;
    }
    return batch;
  }

  private async applyResults(db: LocalDb, sent: OutboxOp[], results: SyncOperationResult[]): Promise<number> {
    const byOpId = new Map(results.map((r) => [r.opId, r]));
    const notices: SyncNotice[] = [];
    let accepted = false;
    let answered = 0;

    await db.transaction('rw', db.notes, db.contents, db.notebooks, db.tags, db.outbox, async () => {
      for (const op of sent) {
        const result = byOpId.get(op.opId);
        if (!result) {
          continue; // no answer for it (should not happen): it stays queued and will be sent again
        }
        answered++;
        await db.outbox.delete(op.seq!);

        const successor = (await db.outbox.where('[entity+id]').equals([op.entity, op.id]).sortBy('seq'))[0];
        switch (result.status) {
          case 'applied':
          case 'conflict':
            accepted = true;
            await this.applyServerState(db, op, result.entity, !!successor);
            if (result.status === 'conflict') {
              notices.push({
                kind: 'conflict',
                message: 'A note was changed on another device at the same time. Your version was kept; the other text was saved in its history.',
              });
            }
            break;

          case 'gone':
            // Deleted on the server: drop the local copy and whatever was still waiting for it.
            await this.removeLocal(db, op.entity, op.id);
            await db.outbox.where('[entity+id]').equals([op.entity, op.id]).delete();
            if (op.entity === 'note' && op.kind === 'upsert') {
              notices.push({ kind: 'gone', message: 'A note you edited was deleted on another device. Your changes are in the trash.' });
            }
            continue;

          case 'rejected':
            // The server will never accept this change as it is. If it says how the thing really is, take that.
            if (result.entity) await this.applyServerState(db, op, result.entity, false);
            notices.push({ kind: 'rejected', message: result.error ?? 'A change could not be saved on the server.' });
            break;
        }

        // The operation that was waiting behind this one can go now. Its base is the version just confirmed.
        if (successor) {
          const row = op.entity === 'note' ? await db.notes.get(op.id) : undefined;
          const confirmed = (result.entity as Note | null)?.version ?? row?.version ?? null;
          await db.outbox.update(successor.seq!, { awaitsBase: false, baseVersion: confirmed && confirmed > 0 ? confirmed : null });
        }
      }
    });

    if (accepted) this.pushedCount.update((n) => n + 1);
    if (notices.length > 0) this.notices.update((current) => [...current, ...notices]);
    return answered;
  }

  /**
   * Writes what the server says into the local row. If another change to the same thing is waiting in the
   * outbox the local row holds newer edits than the server's answer: then only the version is taken over, and
   * the waiting change will bring the rest in line.
   */
  private async applyServerState(db: LocalDb, op: OutboxOp, entity: unknown, hasSuccessor: boolean): Promise<void> {
    if (!entity) {
      return; // e.g. an accepted deletion: nothing to write
    }

    switch (op.entity) {
      case 'note': {
        const server = entity as Note;
        const row = await db.notes.get(op.id);
        if (!row) return; // deleted here in the meantime: do not bring it back
        if (hasSuccessor) {
          await db.notes.update(op.id, { version: server.version, createdAt: server.createdAt });
        } else {
          await this.putNote(db, server);
        }
        break;
      }
      case 'notebook': {
        const server = entity as Notebook;
        if (op.kind === 'delete') {
          // The server refused to delete it (it holds something this device does not know yet): it is back.
          await db.notebooks.put({ id: server.id, name: server.name, parentId: server.parentId, version: 1 });
        } else if (hasSuccessor) {
          if (await db.notebooks.get(op.id)) await db.notebooks.update(op.id, { version: 1 });
        } else {
          await db.notebooks.put({ id: server.id, name: server.name, parentId: server.parentId, version: 1 });
        }
        break;
      }
      case 'tag': {
        const server = entity as Tag;
        if (hasSuccessor) {
          if (await db.tags.get(op.id)) await db.tags.update(op.id, { version: 1 });
        } else {
          await db.tags.put({ id: server.id, name: server.name, version: 1 }); // the server may have renamed it ("work (2)")
        }
        break;
      }
    }
  }

  // ---------------- pull ----------------

  private async pull(): Promise<void> {
    for (;;) {
      if (!this.local.isOpen) return;
      const db = this.local.db;
      const cursor = ((await db.meta.get(CURSOR_KEY))?.value as number | undefined) ?? 0;
      const page = await firstValueFrom(this.api.pull(cursor));
      await this.applyChanges(db, page.changes, page.cursor);
      if (!page.hasMore) {
        return;
      }
    }
  }

  private async applyChanges(db: LocalDb, changes: SyncChange[], cursor: number): Promise<void> {
    await db.transaction('rw', [db.notes, db.contents, db.notebooks, db.tags, db.outbox, db.meta], async () => {
      for (const change of changes) {
        // Changes still waiting here are newer than anything the server says: leave that thing alone. The
        // answer to the push brings the merged result.
        if (await hasPendingOperations(db, change.entity, change.id)) {
          continue;
        }

        if (change.deleted) {
          await this.removeLocal(db, change.entity, change.id);
          continue;
        }

        switch (change.entity) {
          case 'note': {
            const server = change.data as Note;
            const row = await db.notes.get(change.id);
            if (!row || server.version >= row.version) {
              await this.putNote(db, server);
            }
            break;
          }
          case 'notebook': {
            const server = change.data as Notebook;
            await db.notebooks.put({ id: server.id, name: server.name, parentId: server.parentId, version: 1 });
            break;
          }
          case 'tag': {
            const server = change.data as Tag;
            await db.tags.put({ id: server.id, name: server.name, version: 1 });
            break;
          }
        }
      }
      await db.meta.put({ key: CURSOR_KEY, value: cursor });
    });
  }

  // ---------------- local writes of server data (never queue anything) ----------------

  private async putNote(db: LocalDb, server: Note): Promise<void> {
    const row: LocalNote = {
      id: server.id,
      title: server.title,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      version: server.version,
      notebookId: server.notebookId,
      isPinned: server.isPinned,
      status: server.status,
      tagIds: server.tagIds,
    };
    await db.notes.put(row);
    await db.contents.put({ id: server.id, content: server.content });
  }

  /** Removes a thing the server deleted, and tidies what pointed at it. */
  private async removeLocal(db: LocalDb, entity: string, id: string): Promise<void> {
    switch (entity) {
      case 'note':
        await db.notes.delete(id);
        await db.contents.delete(id);
        break;
      case 'notebook':
        await db.notebooks.delete(id);
        await db.notes.where('notebookId').equals(id).modify({ notebookId: null });
        break;
      case 'tag':
        await db.tags.delete(id);
        await db.notes.filter((n) => n.tagIds.includes(id)).modify((n) => {
          n.tagIds = n.tagIds.filter((t) => t !== id);
        });
        break;
    }
  }
}

function toWire(op: OutboxOp): SyncOperation {
  return { opId: op.opId, entity: op.entity, id: op.id, kind: op.kind, baseVersion: op.baseVersion, data: op.data };
}
