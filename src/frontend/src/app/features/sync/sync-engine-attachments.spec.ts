import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api.config';
import { AttachmentRepository } from '../attachments/data/attachment-repository';
import { NotesRepository } from '../notes/data/notes-repository';
import { LocalDbService } from './local/local-db';
import { PullResponse } from './models/sync.model';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncEngine } from './sync-engine.service';

let counter = 0;
const png = (name = 'photo.png') => new File([new Uint8Array(32).fill(3)], name, { type: 'image/png' });
const emptyPull = (): PullResponse => ({ changes: [], cursor: 0, hasMore: false });

describe('SyncEngine: attached files', () => {
  let engine: SyncEngine;
  let local: LocalDbService;
  let notes: NotesRepository;
  let attachments: AttachmentRepository;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SYNC_DEBOUNCE_MS, useValue: 60 },
        { provide: SYNC_INTERVAL_MS, useValue: 0 },
      ],
    });
    engine = TestBed.inject(SyncEngine);
    local = TestBed.inject(LocalDbService);
    notes = TestBed.inject(NotesRepository);
    attachments = TestBed.inject(AttachmentRepository);
    http = TestBed.inject(HttpTestingController);
    await local.open(`engine-files-${++counter}`);
  });

  afterEach(async () => {
    engine.stop();
    await local.wipe();
    http.verify();
  });

  const request = (suffix: string): Promise<TestRequest> => vi.waitFor(() => http.expectOne((r) => r.url.endsWith(suffix)));
  const nextUpload = () => request('/api/attachments');
  const nextPull = () => request('/api/sync/pull');
  const nextPush = () => request('/api/sync/push');
  const operationsOf = (req: TestRequest) => (req.request.body as { operations: Record<string, unknown>[] }).operations;

  /** A note that the server already has: no change of it waits to be sent. */
  async function syncedNote() {
    const note = await notes.create('A note', 'text', null);
    await local.db.outbox.clear();
    return note;
  }

  async function addFile(noteId: string, name = 'photo.png') {
    const result = await attachments.add(noteId, png(name));
    if (result.status !== 'ok') throw new Error('expected ok');
    return result.id;
  }

  it('sends a waiting file as multipart form data with its id, its note and its name', async () => {
    const note = await syncedNote();
    const id = await addFile(note.id, 'My Photo.png');

    const done = engine.syncNow();
    const upload = await nextUpload();

    expect(upload.request.method).toBe('POST');
    expect(upload.request.url).toBe(`${API_BASE_URL}/api/attachments`);
    const form = upload.request.body as FormData;
    expect(form.get('id')).toBe(id);
    expect(form.get('noteId')).toBe(note.id);
    expect((form.get('file') as File).name).toBe('My Photo.png');
    expect((form.get('file') as File).size).toBe(32);
    upload.flush({ id, noteId: note.id, fileName: 'My Photo.png', contentType: 'image/png', sizeBytes: 32, isImage: true, createdAt: '' });
    (await nextPull()).flush(emptyPull());
    await done;
  });

  it('after a successful upload the file leaves the queue but its bytes stay: this device keeps showing it', async () => {
    const note = await syncedNote();
    const id = await addFile(note.id);

    const done = engine.syncNow();
    (await nextUpload()).flush({ id });
    (await nextPull()).flush(emptyPull());
    await done;

    expect(await attachments.uploads()).toEqual([]);
    expect(await attachments.blob(id)).toBeDefined();
    expect(engine.state()).toBe('idle');
  });

  it('sends the NOTE first and the file after it (the file belongs to a note the server must know), then pulls', async () => {
    const note = await notes.create('Brand new', 'text', null); // its creation is still waiting to be sent
    const id = await addFile(note.id);
    const order: string[] = [];

    const done = engine.syncNow();
    const push = await nextPush();
    order.push('push');
    expect(operationsOf(push)[0]).toMatchObject({ entity: 'note', id: note.id });
    http.expectNone((r) => r.url.endsWith('/api/attachments')); // not before the note is on the server
    push.flush({ results: [{ opId: operationsOf(push)[0]['opId'], status: 'applied', entity: { ...(await local.db.notes.get(note.id)), content: 'text', version: 1 }, error: null }] });

    const upload = await nextUpload();
    order.push('upload');
    upload.flush({ id });
    (await nextPull()).flush(emptyPull());
    order.push('pull');
    await done;

    expect(order).toEqual(['push', 'upload', 'pull']);
  });

  it('leaves a file for later while its note still has a change that cannot be sent yet', async () => {
    const note = await syncedNote();
    // A change that waits for the answer to an earlier one (see "awaitsBase"): the push does not send it.
    await local.db.outbox.add({ opId: crypto.randomUUID(), entity: 'note', id: note.id, kind: 'upsert', baseVersion: null, data: { title: 'x' }, awaitsBase: true, attempted: false, createdAt: new Date().toISOString() });
    const id = await addFile(note.id);

    const done = engine.syncNow();
    (await nextPull()).flush(emptyPull());
    await done;

    http.expectNone((r) => r.url.endsWith('/api/attachments'));
    expect(await attachments.uploads()).toMatchObject([{ id }]); // still queued, nothing lost
    expect(engine.state()).toBe('idle'); // waiting is not a failure
  });

  it('sends several files, oldest first, one request each', async () => {
    const note = await syncedNote();
    const first = await addFile(note.id, 'first.png');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await addFile(note.id, 'second.png');

    const done = engine.syncNow();
    const one = await nextUpload();
    expect((one.request.body as FormData).get('id')).toBe(first);
    one.flush({ id: first });
    const two = await nextUpload();
    expect((two.request.body as FormData).get('id')).toBe(second);
    two.flush({ id: second });
    (await nextPull()).flush(emptyPull());
    await done;

    expect(await attachments.uploads()).toEqual([]);
  });

  describe('what the server refuses is final', () => {
    it.each([
      [413, { title: 'The file is too large' }, 'the file is too large'],
      [413, { title: 'Your storage is full' }, 'your storage is full'],
      [415, { title: 'This kind of file is not allowed' }, 'this kind of file is not allowed'],
      [404, { title: 'Note not found' }, 'its note no longer exists'],
      [400, { title: 'The file is empty' }, 'the file is empty'],
    ])('a %i (%j) removes the file from the queue AND this device, and tells the user', async (status, body, words) => {
      const note = await syncedNote();
      const id = await addFile(note.id, 'refused.png');

      const done = engine.syncNow();
      (await nextUpload()).flush(body, { status, statusText: 'No' });
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await attachments.uploads()).toEqual([]);
      expect(await attachments.blob(id)).toBeUndefined(); // nothing shows what the server never had
      expect(engine.notices()).toHaveLength(1);
      expect(engine.notices()[0].kind).toBe('rejected');
      expect(engine.notices()[0].message).toContain('"refused.png"');
      expect(engine.notices()[0].message).toContain(words);
      expect(engine.state()).toBe('idle');
    });

    it('does not try again in the next run', async () => {
      const note = await syncedNote();
      await addFile(note.id);
      const first = engine.syncNow();
      (await nextUpload()).flush({}, { status: 415, statusText: 'Unsupported' });
      (await nextPull()).flush(emptyPull());
      await first;

      const second = engine.syncNow();
      (await nextPull()).flush(emptyPull());
      await second;

      http.expectNone((r) => r.url.endsWith('/api/attachments'));
    });

    it('goes on with the next file after one was refused', async () => {
      const note = await syncedNote();
      const bad = await addFile(note.id, 'bad.png');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const good = await addFile(note.id, 'good.png');

      const done = engine.syncNow();
      (await nextUpload()).flush({}, { status: 415, statusText: 'Unsupported' });
      const second = await nextUpload();
      expect((second.request.body as FormData).get('id')).toBe(good);
      second.flush({ id: good });
      (await nextPull()).flush(emptyPull());
      await done;

      expect(await attachments.blob(bad)).toBeUndefined();
      expect(await attachments.blob(good)).toBeDefined();
      expect(engine.notices()).toHaveLength(1);
    });
  });

  describe('what is not a refusal is tried again later', () => {
    it('no connection: the file stays queued, the run ends as "offline"', async () => {
      const note = await syncedNote();
      const id = await addFile(note.id);

      const done = engine.syncNow();
      (await nextUpload()).error(new ProgressEvent('error'));
      await done;

      expect(await attachments.uploads()).toMatchObject([{ id, attempts: 0 }]); // not the server's fault: no attempt counted
      expect(await attachments.blob(id)).toBeDefined();
      expect(engine.state()).toBe('offline');
      http.expectNone((r) => r.url.endsWith('/api/sync/pull')); // the run stopped
    });

    it.each([500, 503])('a server error (%i): the file stays queued, the attempt is counted, the state says so', async (status) => {
      const note = await syncedNote();
      const id = await addFile(note.id);

      const done = engine.syncNow();
      (await nextUpload()).flush({}, { status, statusText: 'Server Error' });
      await done;

      expect(await attachments.uploads()).toMatchObject([{ id, attempts: 1 }]);
      expect(engine.state()).toBe('error');
      expect(engine.notices()).toEqual([]); // not worth alarming the user: it will be tried again
    });

    it('a refusal met before a lost connection is still told to the user', async () => {
      const note = await syncedNote();
      await addFile(note.id, 'refused.png');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const waiting = await addFile(note.id, 'waiting.png');

      const done = engine.syncNow();
      (await nextUpload()).flush({}, { status: 415, statusText: 'Unsupported' });
      (await nextUpload()).error(new ProgressEvent('error'));
      await done;

      expect(engine.notices()).toHaveLength(1);
      expect((await attachments.uploads()).map((u) => u.id)).toEqual([waiting]);
      expect(engine.state()).toBe('offline');
    });
  });

  it('a queued file whose bytes are gone is dropped without asking the server for anything', async () => {
    const note = await syncedNote();
    const id = await addFile(note.id);
    await local.db.blobs.delete(id);

    const done = engine.syncNow();
    (await nextPull()).flush(emptyPull());
    await done;

    http.expectNone((r) => r.url.endsWith('/api/attachments'));
    expect(await attachments.uploads()).toEqual([]);
  });

  describe('"changes waiting"', () => {
    it('counts files waiting to be uploaded, with the queued changes', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
      const note = await syncedNote();

      await addFile(note.id);
      await vi.waitFor(() => expect(engine.pending()).toBe(1)); // no queued change, only the file

      await notes.saveText(note.id, 'Edited', 'text');
      await vi.waitFor(() => expect(engine.pending()).toBe(2));
      expect(await engine.pendingCount()).toBe(2); // what the sign-out warning counts

      // let the engine finish what it started, so the test ends cleanly
      const push = await nextPush();
      push.flush({ results: [{ opId: operationsOf(push)[0]['opId'], status: 'applied', entity: { ...(await local.db.notes.get(note.id)), content: 'text', version: 2 }, error: null }] });
      (await nextUpload()).flush({});
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.pending()).toBe(0));
    });

    it('a new file starts a synchronization by itself, after a short pause', async () => {
      engine.start();
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.state()).toBe('idle'));
      const note = await syncedNote();

      await addFile(note.id);

      const upload = await nextUpload();
      upload.flush({});
      (await nextPull()).flush(emptyPull());
      await vi.waitFor(() => expect(engine.pending()).toBe(0));
    });
  });
});
