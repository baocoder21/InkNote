import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api.config';
import { Note, NoteSummary } from '../models/note.model';
import { TrashStore } from './trash.store';

const TRASH = `${API_BASE_URL}/api/notes/trash`;

const summary = (id: string): NoteSummary => ({
  id,
  title: `Title ${id}`,
  updatedAt: '2026-01-01T00:00:00Z',
  version: 2,
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
});
const full = (id: string): Note => ({ ...summary(id), content: `Body ${id}`, createdAt: '2026-01-01T00:00:00Z' });

describe('TrashStore', () => {
  let store: InstanceType<typeof TrashStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(TrashStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loaded(...ids: string[]): Promise<void> {
    const promise = store.load();
    http.expectOne(TRASH).flush(ids.map(summary));
    await promise;
  }

  it('load fills the list; a failed load returns false and stops loading', async () => {
    await loaded('a', 'b');
    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);

    const failing = store.load();
    http.expectOne(TRASH).flush('', { status: 500, statusText: 'Server Error' });
    expect(await failing).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('select downloads the deleted note with its content', async () => {
    const promise = store.select('a');
    http.expectOne(`${TRASH}/a`).flush(full('a'));

    expect(await promise).toBe('ok');
    expect(store.selected()?.content).toBe('Body a');
  });

  it('select reports not-found on 404', async () => {
    const promise = store.select('a');
    http.expectOne(`${TRASH}/a`).flush('', { status: 404, statusText: 'Not Found' });

    expect(await promise).toBe('not-found');
    expect(store.selected()).toBeNull();
  });

  it('select ignores an outdated response (race condition)', async () => {
    const slow = store.select('a');
    const fast = store.select('b');
    http.expectOne(`${TRASH}/b`).flush(full('b'));
    await fast;
    http.expectOne(`${TRASH}/a`).flush(full('a')); // arrives late
    await slow;

    expect(store.selected()?.id).toBe('b');
  });

  it('load drops a selection that is no longer in the trash', async () => {
    await loaded('a', 'b');
    const select = store.select('a');
    http.expectOne(`${TRASH}/a`).flush(full('a'));
    await select;

    await loaded('b');

    expect(store.selected()).toBeNull();
  });

  it('restore posts to /restore and removes the note from the list and the selection', async () => {
    await loaded('a', 'b');
    const select = store.select('a');
    http.expectOne(`${TRASH}/a`).flush(full('a'));
    await select;

    const promise = store.restore('a');
    const request = http.expectOne(`${TRASH}/a/restore`);
    expect(request.request.method).toBe('POST');
    request.flush(full('a'));

    expect(await promise).toBe('ok');
    expect(store.items().map((n) => n.id)).toEqual(['b']);
    expect(store.selected()).toBeNull();
  });

  it('restore of a note that left the trash elsewhere answers not-found and stops listing it', async () => {
    await loaded('a');
    const promise = store.restore('a');
    http.expectOne(`${TRASH}/a/restore`).flush('', { status: 404, statusText: 'Not Found' });

    expect(await promise).toBe('not-found');
    expect(store.items()).toEqual([]);
  });

  it('restore keeps the note listed when the server fails', async () => {
    await loaded('a');
    const promise = store.restore('a');
    http.expectOne(`${TRASH}/a/restore`).flush('', { status: 500, statusText: 'Server Error' });

    expect(await promise).toBe('error');
    expect(store.items().map((n) => n.id)).toEqual(['a']);
  });

  it('purge sends DELETE to the trash url and removes the note from the list', async () => {
    await loaded('a', 'b');
    const promise = store.purge('a');
    const request = http.expectOne(`${TRASH}/a`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await promise).toBe('ok');
    expect(store.items().map((n) => n.id)).toEqual(['b']);
  });

  it('empty clears the list and returns how many notes the server deleted', async () => {
    await loaded('a', 'b');
    const promise = store.empty();
    const request = http.expectOne(TRASH);
    expect(request.request.method).toBe('DELETE');
    request.flush({ deleted: 2 });

    expect(await promise).toBe(2);
    expect(store.items()).toEqual([]);
  });

  it('empty returns null and keeps the list when the server fails', async () => {
    await loaded('a');
    const promise = store.empty();
    http.expectOne(TRASH).flush('', { status: 500, statusText: 'Server Error' });

    expect(await promise).toBeNull();
    expect(store.items().length).toBe(1);
  });
});
