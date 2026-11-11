import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NotesRepository } from '../notes/data/notes-repository';
import { OrganizationRepository } from '../notes/data/organization-repository';
import { Note } from '../notes/models/note.model';
import { LocalDbService } from './local/local-db';
import { PullResponse, SyncChange, SyncOperationResult } from './models/sync.model';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncEngine } from './sync-engine.service';

let counter = 0;

const serverNote = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Title',
  content: 'text',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
  ...over,
});

describe('SyncEngine', () => {
  let engine: SyncEngine;
  let local: LocalDbService;
  let notes: NotesRepository;
  let org: OrganizationRepository;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Long enough that a few awaited writes in a row always fall inside ONE pause, even on a loaded machine.
        { provide: SYNC_DEBOUNCE_MS, useValue: 60 },
        { provide: SYNC_INTERVAL_MS, useValue: 0 }, // no timer in tests: they decide when a sync happens
      ],
    });
    engine = TestBed.inject(SyncEngine);
    local = TestBed.inject(LocalDbService);
    notes = TestBed.inject(NotesRepository);
    org = TestBed.inject(OrganizationRepository);
    http = TestBed.inject(HttpTestingController);
    await local.open(`engine-${++counter}`);
  });

  afterEach(async () => {
    engine.stop();
    await local.wipe();
    http.verify();
  });

  // ---- helpers: wait for the engine's request, then answer it ----
  const request = (suffix: string): Promise<TestRequest> =>
    vi.waitFor(() => http.expectOne((r) => r.url.endsWith(suffix)));
  const nextPush = () => request('/api/sync/push');
  const nextPull = () => request('/api/sync/pull');
  const operationsOf = (req: TestRequest) => (req.request.body as { operations: Record<string, unknown>[] }).operations;
  const answer = (req: TestRequest, results: Partial<SyncOperationResult>[]) =>
    req.flush({ results: results.map((r, i) => ({ opId: operationsOf(req)[i]['opId'], status: 'applied', entity: null, error: null, ...r })) });
  const emptyPull = (cursor = 0): PullResponse => ({ changes: [], cursor, hasMore: false });
  const change = (c: Partial<SyncChange> & Pick<SyncChange, 'entity' | 'id'>): SyncChange => ({ seq: 1, deleted: false, data: null, ...c });

  /** A full run in which the server accepts the one queued operation as it is. */
  async function syncOnceAccepting(entity: Note | null) {
    const done = engine.syncNow();
    answer(await nextPush(), [{ entity }]);
    (await nextPull()).flush(emptyPull());
    await done;
  }

  // ======================= push =======================

  describe('push', () => {
    it('sends the queued change with its id and base version, and takes over what the server answers', async () => {
      const note = await notes.create('Draft', 'hello', null);

      const done = engine.syncNow();
      const push = await nextPush();
      const [op] = operationsOf(push);
      expect(op).toMatchObject({ entity: 'note', id: note.id, kind: 'upsert', baseVersion: null, data: { title: 'Draft', content: 'hello', notebookId: null } });
      expect(op['opId']).toMatch(/^[0-9a-f-]{36}$/);

      answer(push, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'hello', version: 1, updatedAt: '2026-03-03T10:00:00Z' }) }]);
      (await nextPull()).flush(emptyPull(5));
      await done;

      const row = await local.db.notes.get(note.id);
      expect(row).toMatchObject({ version: 1, updatedAt: '2026-03-03T10:00:00Z' }); // now the server's version and clock
      expect(await local.db.outbox.count()).toBe(0);
      expect(engine.pushedCount()).toBe(1);
      expect(engine.state()).toBe('idle');
      expect(engine.lastSyncedAt()).not.toBeNull();
    });

    it('does not ask the server for anything when there is nothing to send, but still pulls', async () => {
      const done = engine.syncNow();

      (await nextPull()).flush(emptyPull());
      await done;

      http.expectNone((r) => r.url.endsWith('/push'));
    });

    it('a network failure keeps the change queued, FROZEN, and the retry is exactly the same operation', async () => {
      const note = await notes.create('Draft', 'first', null);
      let done = engine.syncNow();
      const first = await nextPush();
      const sentOp = operationsOf(first)[0];
      first.error(new ProgressEvent('error')); // status 0: no network
      await done;

      expect(engine.state()).toBe('offline');
      const [kept] = await local.db.outbox.toArray();
      expect(kept).toMatchObject({ opId: sentOp['opId'], attempted: true });

      done = engine.syncNow(); // the connection is back
      const retry = await nextPush();
      expect(operationsOf(retry)[0]).toEqual(sentOp); // same opId, same data: the server can tell it is a repeat
      answer(retry, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'first' }) }]);
      (await nextPull()).flush(emptyPull());
      await done;
      expect(await local.db.outbox.count()).toBe(0);
    });

    it('typing after an operation was sent creates a NEW operation that waits, then follows with the confirmed version', async () => {
      const note = await notes.create('Draft', 'one', null);
      const done = engine.syncNow();
      const first = await nextPush(); // on its way...
      await notes.saveText(note.id, 'Draft', 'one two'); // ...and the user keeps typing

      const queued = await local.db.outbox.orderBy('seq').toArray();
      expect(queued).toHaveLength(2);
      expect(queued[1]).toMatchObject({ awaitsBase: true, baseVersion: null, data: { content: 'one two' } });

      answer(first, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'one', version: 1 }) }]);
      // The local row keeps the newer text; only the version was taken over.
      const second = await nextPush();
      expect(operationsOf(second)[0]).toMatchObject({ baseVersion: 1, data: { content: 'one two' } }); // rebased on the answer
      expect((await notes.get(note.id))?.content).toBe('one two');

      answer(second, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'one two', version: 2 }) }]);
      (await nextPull()).flush(emptyPull());
      await done;
      expect((await local.db.notes.get(note.id))?.version).toBe(2);
      expect(await local.db.outbox.count()).toBe(0);
    });

    it('a change made at ANY moment of a run is never lost: it travels with the batch or waits behind it, and the server ends up with it', async () => {
      // The race this guards: the engine used to read the queue and only THEN mark what it would send as "sent". A change
      // made in between was merged into an operation whose data had already been read, so it never reached the server, and
      // the server's answer then put the old value back over the local one (a note dragged into a folder jumped back out).
      // The moment is a matter of a few milliseconds, so many moments are tried, against a tiny fake server.
      const server = new Map<string, Note>();
      const serveUntil = async (finished: Promise<void>) => {
        let over = false;
        void finished.then(() => (over = true));
        while (!over) {
          for (const req of http.match((r) => r.url.endsWith('/api/sync/push'))) {
            const results = operationsOf(req).map((op) => {
              const current = server.get(op['id'] as string) ?? serverNote({ id: op['id'] as string, version: 0 });
              const next = { ...current, ...(op['data'] as object), version: current.version + 1 } as Note;
              server.set(next.id, next);
              return { opId: op['opId'], status: 'applied', entity: next, error: null };
            });
            req.flush({ results });
          }
          for (const req of http.match((r) => r.url.endsWith('/api/sync/pull'))) req.flush(emptyPull());
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };

      for (let moment = 0; moment < 40; moment++) {
        const note = await notes.create(`Note ${moment}`, 'text', null);
        const done = engine.syncNow();
        for (let i = 0; i < moment; i++) await Promise.resolve(); // a different moment each time...
        for (let i = 0; i < moment % 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); // ...at every kind of distance
        await notes.updateOrganization(note.id, { notebookId: `folder-${moment}`, isPinned: false, status: 'None', tagIds: [] });
        await serveUntil(done);
        await serveUntil(engine.syncNow()); // a change that had to wait is sent by the next run

        expect((await local.db.notes.get(note.id))!.notebookId, `moment ${moment}: local`).toBe(`folder-${moment}`);
        expect(server.get(note.id)!.notebookId, `moment ${moment}: server`).toBe(`folder-${moment}`);
        expect(await local.db.outbox.count(), `moment ${moment}: nothing left to send`).toBe(0);
      }
    });

    it('sends the notebooks and tags BEFORE the notes that point to them, even when the note\'s operation is older', async () => {
      // The note has an operation waiting from before; the folder is created after it; moving the note into the folder is
      // merged into that OLDER operation. By queue order the note would reach the server before its folder exists, and the
      // server (which drops a notebook it does not know) would answer "no folder", which then overwrote the local choice.
      const note = await notes.create('Draft', 'text', null); // operation 1: the note
      const folder = await org.createNotebook('Docs', null); // operation 2: the folder
      await notes.updateOrganization(note.id, { notebookId: folder.id, isPinned: false, status: 'None', tagIds: [] }); // merged into 1

      const known = new Set<string>();
      const done = engine.syncNow();
      const push = await nextPush();
      const results = operationsOf(push).map((op) => {
        if (op['entity'] === 'notebook') known.add(op['id'] as string);
        const data = { ...(op['data'] as Record<string, unknown>) };
        if (op['entity'] === 'note' && !known.has(data['notebookId'] as string)) data['notebookId'] = null; // what the server does
        return { opId: op['opId'], status: 'applied', error: null, entity: op['entity'] === 'note' ? serverNote({ id: note.id, title: 'Draft', content: 'text', version: 1, notebookId: (data['notebookId'] as string | null) ?? null }) : null };
      });
      push.flush({ results });
      (await nextPull()).flush(emptyPull());
      await done;

      expect(operationsOf(push).map((o) => o['entity'])).toEqual(['notebook', 'note']);
      expect((await local.db.notes.get(note.id))!.notebookId).toBe(folder.id); // the note kept its folder
    });

    it('an answer never overwrites text typed after the operation was sent', async () => {
      const note = await notes.create('Draft', 'one', null);
      const done = engine.syncNow();
      const first = await nextPush();
      await notes.saveText(note.id, 'Draft', 'one, and more typed meanwhile');

      answer(first, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'one', version: 1 }) }]);
      const second = await nextPush();

      expect((await notes.get(note.id))?.content).toBe('one, and more typed meanwhile');
      answer(second, [{ entity: serverNote({ id: note.id, title: 'Draft', content: 'one, and more typed meanwhile', version: 2 }) }]);
      (await nextPull()).flush(emptyPull());
      await done;
    });

    it('a conflict takes over the merged result and tells the user', async () => {
      const note = await notes.create('T', 'mine', null);
      await local.db.notes.update(note.id, { version: 3 });
      await local.db.outbox.clear();
      await notes.saveText(note.id, 'T', 'mine, edited');

      const done = engine.syncNow();
      answer(await nextPush(), [{ status: 'conflict', entity: serverNote({ id: note.id, title: 'T', content: 'mine, edited', version: 5 }) }]);
      (await nextPull()).flush(emptyPull());
      await done;

      expect((await local.db.notes.get(note.id))?.version).toBe(5);
      expect(engine.notices().map((n) => n.kind)).toEqual(['conflict']);
      expect(engine.notices()[0].message).toContain('another device');
    });

    it('a note deleted elsewhere is removed here, with whatever waited for it, and the user is told', async () => {
      const note = await notes.create('T', 'text', null);
      await local.db.notes.update(note.id, { version: 2 });
      await local.db.outbox.clear();
      await notes.saveText(note.id, 'T', 'edited offline');

      const done = engine.syncNow();
      const push = await nextPush();
      await notes.saveText(note.id, 'T', 'edited again'); // a second edit queued behind the first
      answer(push, [{ status: 'gone' }]);
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await notes.get(note.id)).toBeUndefined();
      expect(await local.db.outbox.count()).toBe(0);
      expect(engine.notices()[0]).toMatchObject({ kind: 'gone' });
    });

    it('a notebook the server refused to delete comes back, with a notice', async () => {
      const notebook = await org.createNotebook('Work', null);
      await local.db.notebooks.update(notebook.id, { version: 1 });
      await local.db.outbox.clear();
      await org.deleteNotebook(notebook.id);

      const done = engine.syncNow();
      answer(await nextPush(), [{ status: 'rejected', entity: { id: notebook.id, name: 'Work', parentId: null } as never, error: 'The notebook still contains notes.' }]);
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await local.db.notebooks.get(notebook.id)).toMatchObject({ name: 'Work' });
      expect(engine.notices()[0]).toMatchObject({ kind: 'rejected', message: 'The notebook still contains notes.' });
      expect(await local.db.outbox.count()).toBe(0);
    });

    it('a tag the server renamed to keep names unique takes the server\'s name here', async () => {
      const tag = await org.createTag('work');
      if (tag.status !== 'ok') throw new Error('expected ok');

      const done = engine.syncNow();
      answer(await nextPush(), [{ entity: { id: tag.tag.id, name: 'work (2)' } as never }]);
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await local.db.tags.get(tag.tag.id)).toMatchObject({ name: 'work (2)', version: 1 });
    });

    it('sends at most 50 operations at a time, and keeps going until the queue is empty', async () => {
      for (let i = 0; i < 60; i++) await notes.create(`Note ${i}`, '', null);

      const done = engine.syncNow();
      const first = await nextPush();
      expect(operationsOf(first)).toHaveLength(50);
      answer(first, operationsOf(first).map(() => ({ entity: null })));
      const second = await nextPush();
      expect(operationsOf(second)).toHaveLength(10);
      answer(second, operationsOf(second).map(() => ({ entity: null })));
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await local.db.outbox.count()).toBe(0);
    });

    it('sends operations in the order they were made', async () => {
      const a = await org.createNotebook('A', null);
      const b = await org.createTag('b');
      const n = await notes.create('N', '', a.id);

      const done = engine.syncNow();
      const push = await nextPush();

      expect(operationsOf(push).map((o) => o['entity'])).toEqual(['notebook', 'tag', 'note']);
      expect(b.status).toBe('ok');
      expect(n.notebookId).toBe(a.id);
      answer(push, [{}, {}, {}]);
      (await nextPull()).flush(emptyPull());
      await done;
    });

    it('stops with an error (instead of sending forever) when the server answers none of the operations', async () => {
      await notes.create('Draft', '', null);

      const done = engine.syncNow();
      (await nextPush()).flush({ results: [] });
      await done;

      expect(engine.state()).toBe('error');
      expect(await local.db.outbox.count()).toBe(1);
    });
  });

  // ======================= pull =======================

  describe('pull', () => {
    it('applies what other devices did, and remembers where it got to', async () => {
      const done = engine.syncNow();
      (await nextPull()).flush({
        changes: [
          change({ seq: 4, entity: 'notebook', id: 'nb1', data: { id: 'nb1', name: 'Work', parentId: null } }),
          change({ seq: 6, entity: 'tag', id: 't1', data: { id: 't1', name: 'urgent' } }),
          change({ seq: 9, entity: 'note', id: 'n1', data: serverNote({ id: 'n1', title: 'From the server', content: 'big text', notebookId: 'nb1', tagIds: ['t1'] }) }),
        ],
        cursor: 9,
        hasMore: false,
      } satisfies PullResponse);
      await done;

      expect(await local.db.notebooks.get('nb1')).toMatchObject({ name: 'Work', version: 1 });
      expect(await local.db.tags.get('t1')).toMatchObject({ name: 'urgent' });
      expect(await local.db.notes.get('n1')).toMatchObject({ title: 'From the server', notebookId: 'nb1', tagIds: ['t1'], version: 1 });
      expect((await local.db.contents.get('n1'))?.content).toBe('big text');
      expect(await local.getCursor()).toBe(9);
      expect(engine.initialSyncDone()).toBe(true);

      const again = engine.syncNow();
      const second = await nextPull();
      expect(second.request.params.get('cursor')).toBe('9'); // asks from where it stopped
      second.flush(emptyPull(9));
      await again;
    });

    it('follows the pages while the server says there is more', async () => {
      const done = engine.syncNow();
      const first = await nextPull();
      expect(first.request.params.get('cursor')).toBe('0');
      first.flush({ changes: [change({ seq: 1, entity: 'tag', id: 'a', data: { id: 'a', name: 'a' } })], cursor: 1, hasMore: true });
      const second = await nextPull();
      expect(second.request.params.get('cursor')).toBe('1');
      second.flush({ changes: [change({ seq: 2, entity: 'tag', id: 'b', data: { id: 'b', name: 'b' } })], cursor: 2, hasMore: false });
      await done;

      expect(await local.db.tags.count()).toBe(2);
      expect(await local.getCursor()).toBe(2);
    });

    it('never overwrites a thing that has changes waiting to be sent', async () => {
      const note = await notes.create('Mine', 'synced text', null);
      await local.db.notes.update(note.id, { version: 2 });
      await local.db.outbox.clear();

      const done = engine.syncNow(); // nothing to push: straight to the pull
      const pull = await nextPull();
      await notes.saveText(note.id, 'Mine', 'typed while the pull was running'); // queued, not sent yet
      pull.flush({
        changes: [change({ seq: 3, entity: 'note', id: note.id, data: serverNote({ id: note.id, title: 'Theirs', content: 'their text', version: 4 }) })],
        cursor: 3,
        hasMore: false,
      });
      await done;

      expect((await notes.get(note.id))?.content).toBe('typed while the pull was running'); // not replaced by "their text"
      expect((await notes.get(note.id))?.title).toBe('Mine');
      expect(await local.db.outbox.count()).toBe(1); // it will be sent, and the server's answer brings the merged result
      expect(await local.getCursor()).toBe(3);       // and the pull still moved on
    });

    it('does not replace a newer local version with an older one from the server', async () => {
      const done = engine.syncNow();
      (await nextPull()).flush({ changes: [change({ seq: 1, entity: 'note', id: 'n1', data: serverNote({ version: 5, title: 'five' }) })], cursor: 1, hasMore: false });
      await done;

      const again = engine.syncNow();
      (await nextPull()).flush({ changes: [change({ seq: 2, entity: 'note', id: 'n1', data: serverNote({ version: 3, title: 'three (stale)' }) })], cursor: 2, hasMore: false });
      await again;

      expect((await local.db.notes.get('n1'))?.title).toBe('five');
    });

    it('removes what was deleted elsewhere, and tidies what pointed at it', async () => {
      await local.db.notebooks.put({ id: 'nb1', name: 'Gone', parentId: null, version: 1 });
      await local.db.tags.put({ id: 't1', name: 'Gone too', version: 1 });
      await local.db.notes.bulkPut([
        { id: 'a', title: 'a', createdAt: '', updatedAt: '', version: 1, notebookId: 'nb1', isPinned: false, status: 'None', tagIds: ['t1', 'keep'] },
        { id: 'b', title: 'b', createdAt: '', updatedAt: '', version: 1, notebookId: null, isPinned: false, status: 'None', tagIds: [] },
      ]);
      await local.db.contents.bulkPut([{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }]);

      const done = engine.syncNow();
      (await nextPull()).flush({
        changes: [
          change({ seq: 1, entity: 'notebook', id: 'nb1', deleted: true }),
          change({ seq: 2, entity: 'tag', id: 't1', deleted: true }),
          change({ seq: 3, entity: 'note', id: 'b', deleted: true }),
        ],
        cursor: 3,
        hasMore: false,
      });
      await done;

      expect(await local.db.notebooks.count()).toBe(0);
      expect(await local.db.tags.count()).toBe(0);
      expect(await local.db.notes.get('b')).toBeUndefined();
      expect(await local.db.contents.get('b')).toBeUndefined();
      expect(await local.db.notes.get('a')).toMatchObject({ notebookId: null, tagIds: ['keep'] });
    });

    it('does not remove a note that was deleted elsewhere while it has unsent edits (the push will be told "gone")', async () => {
      const note = await notes.create('T', 'text', null);
      await local.db.notes.update(note.id, { version: 2 });
      await local.db.outbox.clear();

      const done = engine.syncNow();
      const pull = await nextPull();
      await notes.saveText(note.id, 'T', 'edited while the pull was running');
      pull.flush({ changes: [change({ seq: 8, entity: 'note', id: note.id, deleted: true })], cursor: 8, hasMore: false });
      await done;
      expect(await notes.get(note.id)).toBeDefined(); // still here, with its edits

      const second = engine.syncNow();
      answer(await nextPush(), [{ status: 'gone' }]);
      (await nextPull()).flush(emptyPull(8));
      await second;
      expect(await notes.get(note.id)).toBeUndefined();
    });
  });

  // ======================= states and triggers =======================

  describe('state', () => {
    it('is "offline" when the server cannot be reached and "error" when it fails, and recovers on the next success', async () => {
      let done = engine.syncNow();
      (await nextPull()).error(new ProgressEvent('error'));
      await done;
      expect(engine.state()).toBe('offline');
      expect(engine.initialSyncDone()).toBe(false);

      done = engine.syncNow();
      (await nextPull()).flush('', { status: 500, statusText: 'Server Error' });
      await done;
      expect(engine.state()).toBe('error');

      done = engine.syncNow();
      (await nextPull()).flush(emptyPull());
      await done;
      expect(engine.state()).toBe('idle');
    });

    it('shows "syncing" while it runs', async () => {
      const done = engine.syncNow();
      expect(engine.state()).toBe('syncing');
      (await nextPull()).flush(emptyPull());
      await done;
    });

    it('runs one synchronization at a time: a request made meanwhile makes it run once more afterwards', async () => {
      const first = engine.syncNow();
      const second = engine.syncNow(); // while the first is running
      expect(second).toBe(first); // the same run: not a parallel one

      (await nextPull()).flush(emptyPull());
      await first;
      (await nextPull()).flush(emptyPull()); // the extra run
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
    });

    it('does nothing while the local database is closed', async () => {
      local.close();

      await engine.syncNow();

      http.expectNone(() => true);
      expect(await engine.pendingCount()).toBe(0);
    });

    it('does not even try while the browser says it is offline', async () => {
      const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

      await engine.syncNow();

      online.mockRestore();
      http.expectNone(() => true);
      expect(engine.state()).toBe('offline');
    });

    it('counts what waits to be sent', async () => {
      await notes.create('A', '', null);
      await notes.create('B', '', null);

      expect(await engine.pendingCount()).toBe(2);
    });
  });

  describe('automatic runs', () => {
    it('after a change it waits for a pause, then pushes by itself (many changes, one run)', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull()); // the catch-up run at start

      const note = await notes.create('A', 'x', null);
      await notes.saveText(note.id, 'A', 'xy');
      await notes.saveText(note.id, 'A', 'xyz');

      const push = await nextPush();
      expect(operationsOf(push)).toHaveLength(1); // one merged operation
      expect(operationsOf(push)[0]['data']).toMatchObject({ content: 'xyz' });
      answer(push, [{ entity: serverNote({ id: note.id, title: 'A', content: 'xyz' }) }]);
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.pending()).toBe(0));
    });

    it('keeps the "waiting" count up to date', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));

      await notes.create('A', '', null);
      await vi.waitFor(() => expect(engine.pending()).toBe(1));
      const push = await nextPush(); // sent after the pause; answer it so the test ends cleanly
      answer(push, [{}]);
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.pending()).toBe(0));
    });

    it('syncs when the connection comes back', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));

      window.dispatchEvent(new Event('online'));

      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
    });

    it('shows "offline" when the browser reports that the connection was lost', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));

      window.dispatchEvent(new Event('offline'));

      expect(engine.state()).toBe('offline');
    });

    it('"offline" announced while a run waits for its answer still wins when that answer arrives', async () => {
      engine.start();
      const pull = await nextPull(); // the run is in flight

      window.dispatchEvent(new Event('offline'));
      pull.flush(emptyPull()); // the answer was already on its way
      await vi.waitFor(() => expect(engine.lastSyncedAt()).not.toBeNull()); // the run finished

      expect(engine.state()).toBe('offline'); // not "idle": the browser said the connection is gone
    });

    it('"online" ends the offline state: the next run reports idle again', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
      window.dispatchEvent(new Event('offline'));
      expect(engine.state()).toBe('offline');

      window.dispatchEvent(new Event('online'));
      (await nextPull()).flush(emptyPull());

      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
    });

    it('stops reacting after stop()', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      engine.stop();

      await notes.create('A', '', null);
      await new Promise((resolve) => setTimeout(resolve, 60));

      http.expectNone(() => true);
    });

    it('lets the page clear the notices after showing them', async () => {
      engine.notices.set([{ kind: 'conflict', message: 'x' }]);

      engine.clearNotices();

      expect(engine.notices()).toEqual([]);
    });
  });

  it('turns a failed request into a state, never into an unhandled error', async () => {
    const failing = new HttpErrorResponse({ status: 0 });
    expect(failing.status).toBe(0);
    const done = engine.syncNow();
    (await nextPull()).error(new ProgressEvent('error'));

    await expect(done).resolves.toBeUndefined();
  });

  it('accepting an operation with no entity in the answer (a delete) leaves nothing behind', async () => {
    const note = await notes.create('T', 'b', null);
    await local.db.notes.update(note.id, { version: 2 });
    await local.db.outbox.clear();
    await notes.delete(note.id);

    await syncOnceAccepting(null);

    expect(await local.db.outbox.count()).toBe(0);
    expect(await notes.get(note.id)).toBeUndefined();
  });
});
