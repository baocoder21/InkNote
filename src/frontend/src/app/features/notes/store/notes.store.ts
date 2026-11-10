import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Subscription } from 'rxjs';
import { NotesRepository } from '../data/notes-repository';
import { Note, NoteOrganization, NoteSummary } from '../models/note.model';

interface NotesState {
  // Every note (title and organization only, no content). The sidebar groups, sorts and
  // filters this list itself.
  notes: NoteSummary[];
  selected: Note | null; // the note open in the editor (full content)
  loadingList: boolean;
  loadingSelected: boolean;
  saving: boolean;
  // The open note disappeared while it was open (another device deleted it, and a synchronization brought that here).
  selectedGone: boolean;
  // "Rename" in the sidebar: the id of the note whose title box should get the keyboard focus as
  // soon as the editor shows it. The editor clears it once done.
  titleFocusFor: string | null;
}

const initialState: NotesState = {
  notes: [],
  selected: null,
  loadingList: false,
  loadingSelected: false,
  saving: false,
  selectedGone: false,
  titleFocusFor: null,
};

// What a component needs to know to decide which message to show.
/** 'superseded': another loadNote() came in before this one was answered; the caller should do nothing. */
export type LoadResult = 'ok' | 'not-found' | 'error' | 'superseded';
export type SaveResult = 'ok' | 'not-found' | 'error';
export type OrganizationResult = SaveResult;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Is `b` what we already hold as `a`? (Used to ignore the echo of our own change.) */
function sameNote(a: Note, b: Note): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.content === b.content &&
    a.version === b.version &&
    a.updatedAt === b.updatedAt &&
    a.notebookId === b.notebookId &&
    a.isPinned === b.isPinned &&
    a.status === b.status &&
    sameList(a.tagIds, b.tagIds)
  );
}

/**
 * State of the notes feature. Components read the signals (store.notes(), store.selected()...)
 * and call the methods; they never keep server data themselves.
 *
 * The data comes from the database ON THIS DEVICE (see NotesRepository), through "live queries": whenever
 * anything changes it (this tab, another tab, the synchronization with the server) the signals update by
 * themselves. Nothing here waits for the network.
 */
export const NotesStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, repo = inject(NotesRepository)) => {
    let listWatch: Subscription | null = null;
    let noteWatch: Subscription | null = null;
    // Not part of the state: the most recent loadNote() request, so that a slow answer for note A
    // cannot replace note B.
    let latestRequestedId: string | null = null;
    // Settles the promise of the request still waiting for its first answer, so nobody awaits it forever.
    let abandonPending: (() => void) | null = null;

    return {
      /** Starts watching the list. Resolves when the first answer is in (the list is then on screen). */
      loadNotes(): Promise<boolean> {
        listWatch?.unsubscribe();
        patchState(store, { loadingList: true });
        return new Promise<boolean>((resolve) => {
          let answered = false;
          listWatch = repo.watchSummaries().subscribe({
            next: (notes) => {
              patchState(store, { notes, loadingList: false });
              if (!answered) {
                answered = true;
                resolve(true);
              }
            },
            error: () => {
              patchState(store, { loadingList: false });
              if (!answered) {
                answered = true;
                resolve(false);
              }
            },
          });
        });
      },

      /** Opens a note: reads it, and then keeps watching it for changes made elsewhere. */
      loadNote(id: string): Promise<LoadResult> {
        latestRequestedId = id;
        noteWatch?.unsubscribe();
        abandonPending?.();
        abandonPending = null;
        patchState(store, { selected: null, loadingSelected: true, selectedGone: false });
        return new Promise<LoadResult>((resolve) => {
          let answered = false;
          abandonPending = () => {
            if (!answered) {
              answered = true;
              resolve('superseded');
            }
          };
          noteWatch = repo.watch(id).subscribe({
            next: (note) => {
              if (latestRequestedId !== id) {
                return;
              }
              if (!answered) {
                answered = true;
                abandonPending = null;
                patchState(store, { selected: note ?? null, loadingSelected: false });
                resolve(note ? 'ok' : 'not-found');
                return;
              }

              // Later answers: the note changed. Our own saves come back here too; they equal what is already held.
              const current = store.selected();
              if (!note) {
                patchState(store, { selected: null, selectedGone: true }); // deleted somewhere else
              } else if (!current || !sameNote(current, note)) {
                patchState(store, { selected: note });
              }
            },
            error: () => {
              if (latestRequestedId === id) patchState(store, { loadingSelected: false });
              if (!answered) {
                answered = true;
                resolve('error');
              }
            },
          });
        });
      },

      /**
       * Creates an empty note (inside a notebook, or at the top level when null). It appears in the list by itself.
       * It does NOT select it: the editor loads it after navigation, and until then it still holds the previous
       * note's draft, which it saves first (see NoteEditorComponent.load).
       */
      async createNote(notebookId: string | null = null): Promise<Note | null> {
        try {
          return await repo.create('Untitled', '', notebookId);
        } catch {
          return null;
        }
      },

      async saveNote(id: string, title: string, content: string): Promise<SaveResult> {
        const current = store.selected();
        if (!current || current.id !== id) {
          return 'error';
        }

        patchState(store, { saving: true });
        try {
          if (!(await repo.saveText(id, title, content))) {
            return 'not-found';
          }
          // What the database holds now (text, and the time of this local save): the same as the echo of the live query.
          const saved = await repo.get(id);
          if (saved && store.selected()?.id === id) {
            patchState(store, { selected: saved });
          }
          return 'ok';
        } catch {
          return 'error';
        } finally {
          patchState(store, { saving: false });
        }
      },

      /** Changes notebook, pin, status and tags of ANY note (the open one or not). */
      async updateOrganization(id: string, change: NoteOrganization): Promise<OrganizationResult> {
        try {
          return (await repo.updateOrganization(id, change)) ? 'ok' : 'not-found';
        } catch {
          return 'error';
        }
      },

      /** Asks the editor to put the cursor in the title of note `id` (selecting its text). */
      requestTitleFocus(id: string): void {
        patchState(store, { titleFocusFor: id });
      },

      clearTitleFocus(): void {
        patchState(store, { titleFocusFor: null });
      },

      /** Deletes the note here (the server learns of it at the next synchronization, and keeps it in the trash). */
      async deleteNote(id: string): Promise<boolean> {
        if (store.selected()?.id === id) {
          // Closing it ourselves: the "it vanished" notice is for deletions we did not do.
          noteWatch?.unsubscribe();
          latestRequestedId = null;
          patchState(store, { selected: null });
        }
        try {
          await repo.delete(id);
          return true;
        } catch {
          return false;
        }
      },
    };
  }),
);
