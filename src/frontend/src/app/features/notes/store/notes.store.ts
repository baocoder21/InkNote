import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Note, NoteSummary } from '../models/note.model';
import { NotesApi } from '../services/notes-api.service';

interface NotesState {
  notes: NoteSummary[]; // the sidebar list
  selected: Note | null; // the note open in the editor (full content)
  loadingList: boolean;
  loadingSelected: boolean;
  saving: boolean;
}

const initialState: NotesState = {
  notes: [],
  selected: null,
  loadingList: false,
  loadingSelected: false,
  saving: false,
};

// What a component needs to know to decide which message to show.
export type LoadResult = 'ok' | 'not-found' | 'error';
export type SaveResult = 'ok' | 'conflict' | 'not-found' | 'error';

function toSummary(note: Note): NoteSummary {
  return { id: note.id, title: note.title, updatedAt: note.updatedAt, version: note.version };
}

function statusOf(error: unknown): number | undefined {
  return error instanceof HttpErrorResponse ? error.status : undefined;
}

/**
 * State of the notes feature. Components read the signals (store.notes(), store.selected()...)
 * and call the methods; they never keep server data themselves.
 */
export const NotesStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ notes }) => ({
    count: computed(() => notes().length),
  })),
  withMethods((store, api = inject(NotesApi)) => {
    // Not part of the state: remembers the most recent loadNote() request so that a slow,
    // outdated response (note A) cannot overwrite a newer one (note B).
    let latestRequestedId: string | null = null;

    return {
      async loadNotes(): Promise<boolean> {
        patchState(store, { loadingList: true });
        try {
          const notes = await firstValueFrom(api.list());
          patchState(store, { notes, loadingList: false });
          return true;
        } catch {
          patchState(store, { loadingList: false });
          return false;
        }
      },

      async loadNote(id: string): Promise<LoadResult> {
        latestRequestedId = id;
        patchState(store, { selected: null, loadingSelected: true });
        try {
          const note = await firstValueFrom(api.get(id));
          if (latestRequestedId === id) {
            patchState(store, { selected: note, loadingSelected: false });
          }
          return 'ok';
        } catch (error) {
          if (latestRequestedId === id) {
            patchState(store, { loadingSelected: false });
          }
          return statusOf(error) === 404 ? 'not-found' : 'error';
        }
      },

      /**
       * Creates an empty note and puts it first in the list. It does NOT select it: the editor
       * loads it after navigation, and until then it still holds the previous note's draft,
       * which it saves first (see NoteEditorComponent.load).
       */
      async createNote(): Promise<Note | null> {
        try {
          const note = await firstValueFrom(api.create({ title: 'Untitled', content: '' }));
          patchState(store, { notes: [toSummary(note), ...store.notes()] });
          return note;
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
          const updated = await firstValueFrom(
            api.update(id, { title, content, version: current.version }),
          );
          // Most recently updated note goes first, like the server's ordering.
          const others = store.notes().filter((n) => n.id !== id);
          patchState(store, {
            selected: updated,
            notes: [toSummary(updated), ...others],
            saving: false,
          });
          return 'ok';
        } catch (error) {
          patchState(store, { saving: false });
          const status = statusOf(error);
          if (status === 409) return 'conflict';
          if (status === 404) return 'not-found';
          return 'error';
        }
      },

      async deleteNote(id: string): Promise<boolean> {
        try {
          await firstValueFrom(api.delete(id));
          patchState(store, {
            notes: store.notes().filter((n) => n.id !== id),
            selected: store.selected()?.id === id ? null : store.selected(),
          });
          return true;
        } catch (error) {
          // Already gone on the server: removing it locally is the right outcome too.
          if (statusOf(error) === 404) {
            patchState(store, { notes: store.notes().filter((n) => n.id !== id) });
            return true;
          }
          return false;
        }
      },
    };
  }),
);
