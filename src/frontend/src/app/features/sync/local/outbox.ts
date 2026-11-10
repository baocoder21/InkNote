import { SyncEntity } from '../models/sync.model';
import { LocalDb, OutboxOp } from './local-db';

/*
 * The rules for queuing changes. All of these must be called INSIDE a Dexie transaction that also covers
 * the change of the data itself (see the repositories), so that "the row changed" and "the change is queued"
 * are one atomic fact.
 *
 * Invariant: for any one thing there are at most TWO queued operations: one that was already handed to the
 * network ("attempted": frozen, see OutboxOp.attempted) and one that was not ("pending": still open to
 * merging). Many quick edits therefore collapse into one operation instead of hundreds.
 */

const newId = () => crypto.randomUUID();

async function operationsOf(db: LocalDb, entity: SyncEntity, id: string): Promise<{ attempted?: OutboxOp; pending?: OutboxOp }> {
  const ops = await db.outbox.where('[entity+id]').equals([entity, id]).sortBy('seq');
  return { attempted: ops.find((o) => o.attempted), pending: ops.find((o) => !o.attempted) };
}

/**
 * "These fields of this thing changed" (or: this thing was created, when it has never been synchronized).
 * @param rowVersion the version of the local row (0 = never reached the server)
 */
export async function enqueueUpsert(
  db: LocalDb,
  entity: SyncEntity,
  id: string,
  patch: Record<string, unknown>,
  rowVersion: number,
): Promise<void> {
  const { attempted, pending } = await operationsOf(db, entity, id);

  if (pending) {
    if (pending.kind === 'upsert') {
      // Merge into the operation that has not left yet: the newest value of each field wins.
      await db.outbox.update(pending.seq!, { data: { ...pending.data, ...patch } });
    }
    return; // a queued delete: the thing is going away, there is nothing more to say about it
  }

  await db.outbox.add({
    opId: newId(),
    entity,
    id,
    kind: 'upsert',
    // Created here: no base. Waiting behind an operation that is on its way: the base is the version that
    // operation's answer will bring (filled in then). Otherwise: the version we have.
    baseVersion: attempted ? null : rowVersion > 0 ? rowVersion : null,
    awaitsBase: !!attempted,
    data: patch,
    attempted: false,
    createdAt: new Date().toISOString(),
  });
}

/** "This thing was deleted here." */
export async function enqueueDelete(db: LocalDb, entity: SyncEntity, id: string, rowVersion: number): Promise<void> {
  const { attempted, pending } = await operationsOf(db, entity, id);

  if (pending) {
    if (pending.kind === 'delete') {
      return;
    }
    await db.outbox.delete(pending.seq!); // a queued edit of something that is now deleted is pointless
  }

  if (!attempted && rowVersion === 0) {
    return; // it never reached the server (and nothing about it is on its way): there is nothing to delete there
  }

  await db.outbox.add({
    opId: newId(),
    entity,
    id,
    kind: 'delete',
    baseVersion: rowVersion > 0 ? rowVersion : null,
    awaitsBase: !!attempted, // an unfinished operation on it must be answered first, so the order is kept
    data: null,
    attempted: false,
    createdAt: new Date().toISOString(),
  });
}

/** Does anything wait to be sent for this thing? (Then the server's copy must not overwrite the local one.) */
export async function hasPendingOperations(db: LocalDb, entity: SyncEntity, id: string): Promise<boolean> {
  return (await db.outbox.where('[entity+id]').equals([entity, id]).count()) > 0;
}
