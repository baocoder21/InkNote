import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { SEARCH_MIN_LENGTH, SearchResult } from '../models/search.model';
import { NotesApi } from '../services/notes-api.service';

interface SearchState {
  query: string; // what was searched last (trimmed); '' = no search
  tagId: string | null; // the tag filter the results were asked with
  results: SearchResult[];
  total: number; // all matches, of which `results` shows the pages loaded so far
  page: number; // the last page loaded
  loading: boolean; // the first page of a new search is on its way
  loadingMore: boolean; // another page is on its way
  failed: boolean;
}

const initialState: SearchState = {
  query: '',
  tagId: null,
  results: [],
  total: 0,
  page: 0,
  loading: false,
  loadingMore: false,
  failed: false,
};

/**
 * The results of the search box in the sidebar. The sidebar tells it WHAT to search (the `?q=` of the
 * URL, plus the tag filter); the store asks the server and keeps the pages loaded so far.
 */
export const SearchStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ results, total, query }) => ({
    hasMore: computed(() => results().length < total()),
    // true while a search is on screen (even one with no results): the sidebar then shows results, not the tree
    active: computed(() => query().length >= SEARCH_MIN_LENGTH),
  })),
  withMethods((store, api = inject(NotesApi)) => {
    // Not state: identifies the newest request, so a slow answer to an OLD query (typed a moment ago)
    // can never replace the results of the current one.
    let latest = 0;

    return {
      /** Starts a new search (page 1). A query shorter than the minimum just clears the results. */
      async search(rawQuery: string, tagId: string | null): Promise<void> {
        const query = rawQuery.trim();
        const request = ++latest;
        if (query.length < SEARCH_MIN_LENGTH) {
          patchState(store, { ...initialState });
          return;
        }

        // Keep showing the previous results while the new ones load (no flicker between two letters).
        patchState(store, { query, tagId, loading: true, loadingMore: false, failed: false });
        try {
          const response = await firstValueFrom(api.search(query, { tagId }));
          if (request === latest) {
            patchState(store, { results: response.items, total: response.total, page: response.page, loading: false });
          }
        } catch {
          if (request === latest) {
            patchState(store, { results: [], total: 0, page: 0, loading: false, failed: true });
          }
        }
      },

      /** Adds the next page of the current search to the results ("Show more"). */
      async loadMore(): Promise<void> {
        if (!store.hasMore() || store.loading() || store.loadingMore()) {
          return;
        }
        const request = latest; // not incremented: a NEW search made meanwhile cancels this one
        const query = store.query();
        patchState(store, { loadingMore: true });
        try {
          const response = await firstValueFrom(api.search(query, { tagId: store.tagId(), page: store.page() + 1 }));
          if (request === latest) {
            patchState(store, {
              results: [...store.results(), ...response.items.filter((r) => !store.results().some((x) => x.id === r.id))],
              total: response.total,
              page: response.page,
              loadingMore: false,
            });
          }
        } catch {
          if (request === latest) {
            patchState(store, { loadingMore: false, failed: true });
          }
        }
      },

      clear(): void {
        latest++;
        patchState(store, { ...initialState });
      },
    };
  }),
);
