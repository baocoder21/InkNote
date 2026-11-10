import { Injectable, signal } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { NoteStatus } from '../../notes/models/note.model';
import { SyncEntity, SyncKind } from '../models/sync.model';

/**
 * A note as stored on this device WITHOUT its text. The text lives in its own table (LocalContent): the
 * sidebar lists every note on every change, and it must not read hundreds of kilobytes of text to do so.
 * `version` is the last version the SERVER told us about (0 = never synchronized: created here).
 */
export interface LocalNote {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  notebookId: string | null;
  isPinned: boolean;
  status: NoteStatus;
  tagIds: string[];
}

export interface LocalContent {
  id: string; // the note's id
  content: string;
}

export interface LocalNotebook {
  id: string;
  name: string;
  parentId: string | null;
  /** 0 = created here and never synchronized; 1 = the server knows it (notebooks have no real version). */
  version: number;
}

export interface LocalTag {
  id: string;
  name: string;
  /** 0 = created here and never synchronized; 1 = the server knows it (tags have no real version). */
  version: number;
}

/**
 * One change waiting to be sent: the OUTBOX (sync queue). Changes are queued in the same database
 * transaction as the change itself, so the two can never get out of step.
 */
export interface OutboxOp {
  seq?: number; // the order in which changes were made (auto-numbered by the database)
  opId: string;
  entity: SyncEntity;
  id: string;
  kind: SyncKind;
  baseVersion: number | null;
  data: Record<string, unknown> | null;
  /**
   * true once this operation was handed to the network (even if no answer ever came). From then on it is
   * NEVER changed: the server may have applied it, and a retry must be the same operation (same opId, same
   * data) for the server to recognize it. Later edits go into a new operation instead.
   */
  attempted: boolean;
  /** Waits for the answer to an earlier operation on the same thing: its base version is not known yet. */
  awaitsBase: boolean;
  createdAt: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/** The IndexedDB database of ONE user on this device (see LocalDbService). */
export class LocalDb extends Dexie {
  notes!: Table<LocalNote, string>;
  contents!: Table<LocalContent, string>;
  notebooks!: Table<LocalNotebook, string>;
  tags!: Table<LocalTag, string>;
  outbox!: Table<OutboxOp, number>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    // The string after each table name lists the primary key first, then the indexed fields.
    // "++seq" = an auto-incrementing number; "[entity+id]" = an index on the two fields together.
    this.version(1).stores({
      notes: 'id, notebookId, updatedAt',
      contents: 'id',
      notebooks: 'id, parentId',
      tags: 'id',
      outbox: '++seq, opId, [entity+id]',
      meta: 'key',
    });
  }
}

export const CURSOR_KEY = 'cursor';

/**
 * Holds the open database. Each user gets a database of their own (named after the user id): somebody who
 * signs in on a shared computer never sees, or mixes up, another account's notes.
 */
@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private current: LocalDb | null = null;
  private currentUserId: string | null = null;

  /** Changes when a database is opened or closed (for things that must start or stop with it). */
  readonly openUserId = signal<string | null>(null);

  /** The open database. Using it before open() is a bug in the code, hence the exception. */
  get db(): LocalDb {
    if (!this.current) {
      throw new Error('The local database is not open yet.');
    }
    return this.current;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  async open(userId: string): Promise<LocalDb> {
    if (this.current && this.currentUserId === userId) {
      return this.current;
    }
    this.close();
    const db = new LocalDb(`inknote-${userId}`);
    await db.open();
    this.current = db;
    this.currentUserId = userId;
    this.openUserId.set(userId);
    return db;
  }

  close(): void {
    this.current?.close();
    this.current = null;
    this.currentUserId = null;
    this.openUserId.set(null);
  }

  /** Deletes this user's data from this device (sign-out): nothing stays behind for the next person. */
  async wipe(): Promise<void> {
    const db = this.current;
    this.close();
    await db?.delete();
  }

  async getCursor(): Promise<number> {
    return ((await this.db.meta.get(CURSOR_KEY))?.value as number | undefined) ?? 0;
  }
}
