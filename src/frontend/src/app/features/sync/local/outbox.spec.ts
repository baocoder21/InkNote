import { TestBed } from '@angular/core/testing';
import { LocalDbService, OutboxOp } from './local-db';
import { enqueueDelete, enqueueUpsert, hasPendingOperations } from './outbox';

let counter = 0;

describe('the outbox rules', () => {
  let local: LocalDbService;

  beforeEach(async () => {
    local = TestBed.inject(LocalDbService);
    await local.open(`outbox-${++counter}`);
  });

  afterEach(() => local.wipe());

  const ops = (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray();
  const tx = <T>(work: () => Promise<T>) => local.db.transaction('rw', local.db.outbox, work);
  const markAttempted = async () => {
    for (const op of await ops()) await local.db.outbox.update(op.seq!, { attempted: true });
  };

  describe('edits', () => {
    it('a thing created here is queued with no base version', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'A' }, 0));

      const [op] = await ops();
      expect(op).toMatchObject({ entity: 'note', id: 'n1', kind: 'upsert', baseVersion: null, awaitsBase: false, attempted: false, data: { title: 'A' } });
      expect(op.opId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('an edit of a synchronized thing carries the version the device had', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'B' }, 7));

      expect((await ops())[0].baseVersion).toBe(7);
    });

    it('many quick edits become ONE operation, the newest value of each field winning', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'a', content: '1' }, 3));
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { content: '2' }, 3));
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { content: '3', isPinned: true }, 3));

      const all = await ops();
      expect(all).toHaveLength(1);
      expect(all[0].data).toEqual({ title: 'a', content: '3', isPinned: true });
      expect(all[0].baseVersion).toBe(3); // the base stays the one from the FIRST edit
    });

    it('different things get different operations', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'a' }, 1));
      await tx(() => enqueueUpsert(local.db, 'note', 'n2', { title: 'b' }, 1));
      await tx(() => enqueueUpsert(local.db, 'tag', 'n1', { name: 't' }, 1)); // same id, other kind of thing

      expect(await ops()).toHaveLength(3);
    });

    it('an operation that was already sent is never changed: the next edit becomes a new one that waits for the answer', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'sent' }, 2));
      await markAttempted(); // handed to the network; the answer may never come

      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'newer' }, 2));

      const [sent, next] = await ops();
      expect(sent.data).toEqual({ title: 'sent' }); // frozen: a retry must be the same operation
      expect(sent.attempted).toBe(true);
      expect(next).toMatchObject({ attempted: false, awaitsBase: true, baseVersion: null, data: { title: 'newer' } });
    });

    it('further edits merge into the waiting operation, not into the sent one', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'sent' }, 2));
      await markAttempted();
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'x' }, 2));
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { content: 'y' }, 2));

      const all = await ops();
      expect(all).toHaveLength(2);
      expect(all[1].data).toEqual({ title: 'x', content: 'y' });
    });

    it('an edit after a queued delete adds nothing', async () => {
      await tx(() => enqueueDelete(local.db, 'note', 'n1', 4));

      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'ghost' }, 4));

      const all = await ops();
      expect(all).toHaveLength(1);
      expect(all[0].kind).toBe('delete');
    });
  });

  describe('deletes', () => {
    it('deleting a synchronized thing queues a delete', async () => {
      await tx(() => enqueueDelete(local.db, 'note', 'n1', 5));

      expect((await ops())[0]).toMatchObject({ kind: 'delete', baseVersion: 5, awaitsBase: false, data: null });
    });

    it('deleting something that never reached the server leaves nothing to send', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'draft' }, 0)); // the create, still queued

      await tx(() => enqueueDelete(local.db, 'note', 'n1', 0));

      expect(await ops()).toEqual([]);
    });

    it('a queued edit is replaced by the delete (the edit is pointless now)', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'edit' }, 5));

      await tx(() => enqueueDelete(local.db, 'note', 'n1', 5));

      const all = await ops();
      expect(all).toHaveLength(1);
      expect(all[0].kind).toBe('delete');
    });

    it('deleting twice queues one delete', async () => {
      await tx(() => enqueueDelete(local.db, 'note', 'n1', 5));
      await tx(() => enqueueDelete(local.db, 'note', 'n1', 5));

      expect(await ops()).toHaveLength(1);
    });

    it('a create that may already be on the server is followed by a delete that waits for its answer', async () => {
      await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'created' }, 0));
      await markAttempted(); // the create is on its way (maybe applied)

      await tx(() => enqueueDelete(local.db, 'note', 'n1', 0));

      const [create, del] = await ops();
      expect(create.kind).toBe('upsert');
      expect(del).toMatchObject({ kind: 'delete', awaitsBase: true }); // sent only after the create is answered: the order is kept
    });
  });

  it('knows whether something waits to be sent for a thing', async () => {
    expect(await hasPendingOperations(local.db, 'note', 'n1')).toBe(false);

    await tx(() => enqueueUpsert(local.db, 'note', 'n1', { title: 'a' }, 1));

    expect(await hasPendingOperations(local.db, 'note', 'n1')).toBe(true);
    expect(await hasPendingOperations(local.db, 'note', 'other')).toBe(false);
  });
});
