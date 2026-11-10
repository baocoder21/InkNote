// The protocol of /api/sync (see SyncContracts.cs and SyncService.cs on the server).
import { Note } from '../../notes/models/note.model';
import { Notebook, Tag } from '../../notes/models/organization.model';

export type SyncEntity = 'note' | 'notebook' | 'tag';
export type SyncKind = 'upsert' | 'delete';
export type SyncStatus = 'applied' | 'conflict' | 'rejected' | 'gone';

/** One change made on this device, as sent to the server. */
export interface SyncOperation {
  opId: string; // identifies THIS change: sending it twice must not apply it twice
  entity: SyncEntity;
  id: string;
  kind: SyncKind;
  baseVersion: number | null; // the version the device had when it made the change; null = created here
  data: Record<string, unknown> | null; // only the fields that changed
}

export interface SyncOperationResult {
  opId: string;
  status: SyncStatus;
  entity: Note | Notebook | Tag | null; // the server's current version of the thing, when there is one
  error: string | null;
}

export interface PushResponse {
  results: SyncOperationResult[];
}

/** One thing that changed on the server. `deleted` ones carry no data. */
export interface SyncChange {
  seq: number;
  entity: SyncEntity;
  id: string;
  deleted: boolean;
  data: Note | Notebook | Tag | null;
}

export interface PullResponse {
  changes: SyncChange[];
  cursor: number; // ask from here next time
  hasMore: boolean;
}

/** At most this many operations per request (the server refuses more). */
export const MAX_OPERATIONS_PER_PUSH = 50;
