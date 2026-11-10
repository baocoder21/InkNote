import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom, forkJoin } from 'rxjs';
import { Notebook, Tag } from '../models/organization.model';
import { buildNotebookTree, byName, flattenNotebooks } from '../organization/notebook-tree';
import { OrganizationApi } from '../services/organization-api.service';

interface OrganizationState {
  notebooks: Notebook[]; // flat, as the API returns them
  tags: Tag[];
  loading: boolean;
}

const initialState: OrganizationState = { notebooks: [], tags: [], loading: false };

export type RenameNotebookResult = 'ok' | 'not-found' | 'error';
// 'not-empty' = the server refused (409): the notebook still has notes or sub-notebooks.
export type DeleteNotebookResult = 'ok' | 'not-empty' | 'error';
export type CreateTagResult = { status: 'ok'; tag: Tag } | { status: 'duplicate' | 'error' };

function statusOf(error: unknown): number | undefined {
  return error instanceof HttpErrorResponse ? error.status : undefined;
}

/**
 * Notebooks and tags (the "organization" of notes). Kept apart from NotesStore: it changes
 * rarely, and several components (sidebar, editor) read it.
 */
export const OrganizationStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ notebooks }) => {
    const tree = computed(() => buildNotebookTree(notebooks()));
    return {
      tree, // nested, for the sidebar
      notebookOptions: computed(() => flattenNotebooks(tree())), // flat + depth, for pickers
    };
  }),
  withMethods((store, api = inject(OrganizationApi)) => ({
    async load(): Promise<boolean> {
      patchState(store, { loading: true });
      try {
        // Both requests run in parallel; we continue when both have answered.
        const { notebooks, tags } = await firstValueFrom(
          forkJoin({ notebooks: api.listNotebooks(), tags: api.listTags() }),
        );
        patchState(store, { notebooks, tags, loading: false });
        return true;
      } catch {
        patchState(store, { loading: false });
        return false;
      }
    },

    async createNotebook(name: string, parentId: string | null): Promise<Notebook | null> {
      try {
        const notebook = await firstValueFrom(api.createNotebook(name, parentId));
        patchState(store, { notebooks: [...store.notebooks(), notebook] });
        return notebook;
      } catch {
        return null;
      }
    },

    async renameNotebook(id: string, name: string): Promise<RenameNotebookResult> {
      const current = store.notebooks().find((n) => n.id === id);
      if (!current) {
        return 'not-found';
      }
      try {
        const updated = await firstValueFrom(api.updateNotebook(id, name, current.parentId));
        patchState(store, { notebooks: store.notebooks().map((n) => (n.id === id ? updated : n)) });
        return 'ok';
      } catch (error) {
        return statusOf(error) === 404 ? 'not-found' : 'error';
      }
    },

    async deleteNotebook(id: string): Promise<DeleteNotebookResult> {
      try {
        await firstValueFrom(api.deleteNotebook(id));
      } catch (error) {
        const status = statusOf(error);
        if (status === 409) return 'not-empty';
        if (status !== 404) return 'error'; // 404: already gone, removing it locally is right
      }
      patchState(store, { notebooks: store.notebooks().filter((n) => n.id !== id) });
      return 'ok';
    },

    async createTag(name: string): Promise<CreateTagResult> {
      try {
        const tag = await firstValueFrom(api.createTag(name));
        patchState(store, { tags: [...store.tags(), tag].sort(byName) });
        return { status: 'ok', tag };
      } catch (error) {
        return { status: statusOf(error) === 409 ? 'duplicate' : 'error' };
      }
    },

    async deleteTag(id: string): Promise<boolean> {
      try {
        await firstValueFrom(api.deleteTag(id));
      } catch (error) {
        if (statusOf(error) !== 404) return false;
      }
      patchState(store, { tags: store.tags().filter((t) => t.id !== id) });
      return true;
    },
  })),
);
