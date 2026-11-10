import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api.config';
import { SearchResponse, SearchResult } from '../models/search.model';
import { SearchStore } from './search.store';

const SEARCH = `${API_BASE_URL}/api/notes/search`;

const result = (id: string): SearchResult => ({
  id,
  title: [{ text: `Title ${id}`, match: false }],
  snippet: [{ text: 'text', match: false }],
  updatedAt: '2026-01-01T00:00:00Z',
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
});
const response = (ids: string[], total = ids.length, page = 1): SearchResponse => ({
  items: ids.map(result),
  total,
  page,
  pageSize: 20,
});

describe('SearchStore', () => {
  let store: InstanceType<typeof SearchStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(SearchStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** The search request the store sent (matched by its parameters, whatever their order). */
  const expectSearch = (q: string, extra: Record<string, string> = {}) =>
    http.expectOne((r) => {
      if (r.url !== SEARCH || r.params.get('q') !== q) return false;
      return Object.entries(extra).every(([k, v]) => r.params.get(k) === v);
    });

  it('starts idle: no search is active', () => {
    expect(store.active()).toBe(false);
    expect(store.results()).toEqual([]);
  });

  it('asks the server and keeps the results, the total and the query', async () => {
    const searching = store.search('  hello  ', null);
    expectSearch('hello', { page: '1' }).flush(response(['a', 'b'], 2));
    await searching;

    expect(store.query()).toBe('hello'); // trimmed
    expect(store.results().map((r) => r.id)).toEqual(['a', 'b']);
    expect(store.total()).toBe(2);
    expect(store.active()).toBe(true);
    expect(store.hasMore()).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('passes the tag filter to the server', async () => {
    const searching = store.search('hello', 'tag-1');
    expectSearch('hello', { tagId: 'tag-1' }).flush(response(['a']));
    await searching;

    expect(store.tagId()).toBe('tag-1');
  });

  it('does not search a query shorter than the minimum and clears the old results', async () => {
    const first = store.search('hello', null);
    expectSearch('hello').flush(response(['a']));
    await first;

    await store.search('h', null);

    http.expectNone(SEARCH); // nothing was sent
    expect(store.results()).toEqual([]);
    expect(store.active()).toBe(false);
    await store.search('   ', null);
    expect(store.active()).toBe(false);
  });

  it('keeps showing the previous results while a new search is loading (no flicker between letters)', async () => {
    const first = store.search('he', null);
    expectSearch('he').flush(response(['a']));
    await first;

    const second = store.search('hel', null);

    expect(store.loading()).toBe(true);
    expect(store.results().map((r) => r.id)).toEqual(['a']); // still there
    expectSearch('hel').flush(response(['b']));
    await second;
    expect(store.results().map((r) => r.id)).toEqual(['b']);
  });

  it('ignores a slow answer to an old query (typed a moment ago)', async () => {
    const old = store.search('he', null);
    const current = store.search('hello', null);
    expectSearch('hello').flush(response(['current']));
    await current;

    expectSearch('he').flush(response(['old'])); // arrives late
    await old;

    expect(store.results().map((r) => r.id)).toEqual(['current']);
    expect(store.query()).toBe('hello');
  });

  it('reports a failed search and clears the results', async () => {
    const searching = store.search('hello', null);
    expectSearch('hello').flush('', { status: 500, statusText: 'Server Error' });
    await searching;

    expect(store.failed()).toBe(true);
    expect(store.results()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('a new search forgets an earlier failure', async () => {
    const failing = store.search('hello', null);
    expectSearch('hello').flush('', { status: 500, statusText: 'Server Error' });
    await failing;

    const again = store.search('hello', null);
    expect(store.failed()).toBe(false);
    expectSearch('hello').flush(response(['a']));
    await again;
  });

  describe('more pages', () => {
    async function firstPage() {
      const searching = store.search('hello', 'tag-1');
      expectSearch('hello').flush(response(['a', 'b'], 5));
      await searching;
    }

    it('shows that there is more when the total is larger than what was loaded', async () => {
      await firstPage();

      expect(store.hasMore()).toBe(true);
    });

    it('loadMore asks for the next page with the same query and filter, and appends', async () => {
      await firstPage();

      const more = store.loadMore();
      expect(store.loadingMore()).toBe(true);
      expectSearch('hello', { page: '2', tagId: 'tag-1' }).flush(response(['c', 'd'], 5, 2));
      await more;

      expect(store.results().map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(store.loadingMore()).toBe(false);
      expect(store.hasMore()).toBe(true);
    });

    it('stops when everything is loaded, and does not repeat a note that shifted pages', async () => {
      await firstPage();
      const second = store.loadMore();
      expectSearch('hello', { page: '2' }).flush(response(['b', 'c', 'd'], 5, 2)); // "b" again: it moved
      await second;
      const third = store.loadMore();
      expectSearch('hello', { page: '3' }).flush(response(['e'], 5, 3));
      await third;

      expect(store.results().map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(store.hasMore()).toBe(false);
      await store.loadMore(); // nothing left to ask for
      http.expectNone(SEARCH);
    });

    it('does not start a second page request while one is running', async () => {
      await firstPage();

      const one = store.loadMore();
      const two = store.loadMore();
      expectSearch('hello', { page: '2' }).flush(response(['c', 'd'], 5, 2)); // exactly one request
      await Promise.all([one, two]);
    });

    it('an answer for the old search is dropped when a new search started meanwhile', async () => {
      await firstPage();
      const more = store.loadMore();
      const fresh = store.search('other', null);

      expectSearch('hello', { page: '2' }).flush(response(['late'], 5, 2));
      expectSearch('other').flush(response(['x']));
      await Promise.all([more, fresh]);

      expect(store.results().map((r) => r.id)).toEqual(['x']);
    });
  });

  it('clear goes back to idle and ignores an answer that is still on its way', async () => {
    const searching = store.search('hello', null);
    store.clear();
    expectSearch('hello').flush(response(['a']));
    await searching;

    expect(store.active()).toBe(false);
    expect(store.results()).toEqual([]);
  });
});
