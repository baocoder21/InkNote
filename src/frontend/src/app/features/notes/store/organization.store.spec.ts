import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api.config';
import { Notebook, Tag } from '../models/organization.model';
import { OrganizationStore } from './organization.store';

const NOTEBOOKS = `${API_BASE_URL}/api/notebooks`;
const TAGS = `${API_BASE_URL}/api/tags`;

const nb = (id: string, name: string, parentId: string | null = null): Notebook => ({ id, name, parentId });
const tag = (id: string, name: string): Tag => ({ id, name });

describe('OrganizationStore', () => {
  let store: InstanceType<typeof OrganizationStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(OrganizationStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loaded(notebooks: Notebook[], tags: Tag[]): Promise<void> {
    const promise = store.load();
    http.expectOne(NOTEBOOKS).flush(notebooks);
    http.expectOne(TAGS).flush(tags);
    await promise;
  }

  it('load fetches notebooks and tags together and builds the tree', async () => {
    await loaded([nb('p', 'Parent'), nb('c', 'Child', 'p')], [tag('t', 'work')]);

    expect(store.tags()).toEqual([tag('t', 'work')]);
    expect(store.tree().map((n) => n.notebook.id)).toEqual(['p']);
    expect(store.tree()[0].children.map((n) => n.notebook.id)).toEqual(['c']);
    expect(store.notebookOptions().map((o) => [o.notebook.id, o.depth])).toEqual([
      ['p', 0],
      ['c', 1],
    ]);
    expect(store.loading()).toBe(false);
  });

  it('load returns false and stops loading when a request fails', async () => {
    const promise = store.load();
    http.expectOne(NOTEBOOKS).flush('boom', { status: 500, statusText: 'Server Error' });
    http.match(TAGS); // the second request is cancelled by forkJoin or still open: ignore it

    expect(await promise).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('createNotebook posts name and parent and adds the notebook to the tree', async () => {
    await loaded([nb('p', 'Parent')], []);

    const promise = store.createNotebook('Child', 'p');
    const request = http.expectOne(NOTEBOOKS);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Child', parentId: 'p' });
    request.flush(nb('c', 'Child', 'p'));

    expect((await promise)?.id).toBe('c');
    expect(store.tree()[0].children.map((n) => n.notebook.name)).toEqual(['Child']);
  });

  it('createNotebook returns null when the server refuses', async () => {
    const promise = store.createNotebook('X', 'missing-parent');
    http.expectOne(NOTEBOOKS).flush('', { status: 400, statusText: 'Bad Request' });

    expect(await promise).toBeNull();
    expect(store.notebooks()).toEqual([]);
  });

  it('renameNotebook sends the new name together with the unchanged parent', async () => {
    await loaded([nb('p', 'Parent'), nb('c', 'Child', 'p')], []);

    const promise = store.renameNotebook('c', 'Renamed');
    const request = http.expectOne(`${NOTEBOOKS}/c`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ name: 'Renamed', parentId: 'p' });
    request.flush(nb('c', 'Renamed', 'p'));

    expect(await promise).toBe('ok');
    expect(store.notebooks().find((n) => n.id === 'c')?.name).toBe('Renamed');
  });

  it('deleteNotebook removes it, but keeps it when the server says it is not empty (409)', async () => {
    await loaded([nb('a', 'A'), nb('b', 'B')], []);

    const refused = store.deleteNotebook('a');
    http.expectOne(`${NOTEBOOKS}/a`).flush('', { status: 409, statusText: 'Conflict' });
    expect(await refused).toBe('not-empty');
    expect(store.notebooks().map((n) => n.id)).toEqual(['a', 'b']);

    const deleted = store.deleteNotebook('b');
    http.expectOne(`${NOTEBOOKS}/b`).flush(null, { status: 204, statusText: 'No Content' });
    expect(await deleted).toBe('ok');
    expect(store.notebooks().map((n) => n.id)).toEqual(['a']);
  });

  it('createTag keeps tags sorted by name and reports a duplicate (409)', async () => {
    await loaded([], [tag('1', 'beta')]);

    const created = store.createTag('Alpha');
    http.expectOne(TAGS).flush(tag('2', 'Alpha'));
    expect(await created).toEqual({ status: 'ok', tag: tag('2', 'Alpha') });
    expect(store.tags().map((t) => t.name)).toEqual(['Alpha', 'beta']);

    const duplicate = store.createTag('BETA');
    http.expectOne(TAGS).flush('', { status: 409, statusText: 'Conflict' });
    expect(await duplicate).toEqual({ status: 'duplicate' });
    expect(store.tags()).toHaveLength(2);
  });

  it('deleteTag removes the tag', async () => {
    await loaded([], [tag('1', 'a'), tag('2', 'b')]);

    const promise = store.deleteTag('1');
    http.expectOne(`${TAGS}/1`).flush(null, { status: 204, statusText: 'No Content' });

    expect(await promise).toBe(true);
    expect(store.tags().map((t) => t.id)).toEqual(['2']);
  });
});
