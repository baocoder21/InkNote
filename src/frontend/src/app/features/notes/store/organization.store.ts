import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Subscription } from 'rxjs';
import { OrganizationRepository } from '../data/organization-repository';
import { Notebook, Tag } from '../models/organization.model';
import { buildNotebookTree, byName, flattenNotebooks } from '../organization/notebook-tree';

interface OrganizationState {
  notebooks: Notebook[]; // flat, as stored
  tags: Tag[];
  loading: boolean;
}

const initialState: OrganizationState = { notebooks: [], tags: [], loading: false };

export type RenameNotebookResult = 'ok' | 'not-found' | 'error';
// 'not-empty' = the notebook still has notes or sub-notebooks.
export type DeleteNotebookResult = 'ok' | 'not-empty' | 'error';
export type CreateTagResult = { status: 'ok'; tag: Tag } | { status: 'duplicate' | 'error' };

/**
 * Notebooks and tags (the "organization" of notes). Kept apart from NotesStore: it changes
 * rarely, and several components (sidebar, editor) read it. Like NotesStore it reads and writes the database
 * on this device through live queries (see OrganizationRepository).
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
  withMethods((store, repo = inject(OrganizationRepository)) => {
    let notebookWatch: Subscription | null = null;
    let tagWatch: Subscription | null = null;

    return {
      /** Starts watching notebooks and tags. Resolves when both first answers are in. */
      load(): Promise<boolean> {
        notebookWatch?.unsubscribe();
        tagWatch?.unsubscribe();
        patchState(store, { loading: true });

        const notebooksReady = new Promise<boolean>((resolve) => {
          let answered = false;
          notebookWatch = repo.watchNotebooks().subscribe({
            next: (notebooks) => {
              patchState(store, { notebooks });
              if (!answered) {
                answered = true;
                resolve(true);
              }
            },
            error: () => {
              if (!answered) {
                answered = true;
                resolve(false);
              }
            },
          });
        });
        const tagsReady = new Promise<boolean>((resolve) => {
          let answered = false;
          tagWatch = repo.watchTags().subscribe({
            next: (tags) => {
              patchState(store, { tags: [...tags].sort(byName) });
              if (!answered) {
                answered = true;
                resolve(true);
              }
            },
            error: () => {
              if (!answered) {
                answered = true;
                resolve(false);
              }
            },
          });
        });

        return Promise.all([notebooksReady, tagsReady]).then(([a, b]) => {
          patchState(store, { loading: false });
          return a && b;
        });
      },

      async createNotebook(name: string, parentId: string | null): Promise<Notebook | null> {
        try {
          return await repo.createNotebook(name, parentId);
        } catch {
          return null;
        }
      },

      async renameNotebook(id: string, name: string): Promise<RenameNotebookResult> {
        try {
          return (await repo.renameNotebook(id, name)) ? 'ok' : 'not-found';
        } catch {
          return 'error';
        }
      },

      async deleteNotebook(id: string): Promise<DeleteNotebookResult> {
        try {
          const result = await repo.deleteNotebook(id);
          return result === 'not-empty' ? 'not-empty' : 'ok'; // "not found" = already gone: the wish is already true
        } catch {
          return 'error';
        }
      },

      async createTag(name: string): Promise<CreateTagResult> {
        try {
          return await repo.createTag(name);
        } catch {
          return { status: 'error' };
        }
      },

      async deleteTag(id: string): Promise<boolean> {
        try {
          await repo.deleteTag(id);
          return true;
        } catch {
          return false;
        }
      },
    };
  }),
);
