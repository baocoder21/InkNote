import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Note, NoteOrganization, NoteSummary } from '../models/note.model';
import { NotesApi } from '../services/notes-api.service';

interface NotesState {
  // Every note (title and organization only, no content). The sidebar groups, sorts and
  // filters this list itself.
  notes: NoteSummary[];
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
// 'invalid' = the notebook or a tag does not exist any more (the server answered 400).
export type OrganizationResult = SaveResult | 'invalid';

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    updatedAt: note.updatedAt,
    version: note.version,
    notebookId: note.notebookId,
    isPinned: note.isPinned,
    status: note.status,
    tagIds: note.tagIds,
  };
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
       * Creates an empty note (inside a notebook, or at the top level when null) and adds it to
       * the list. It does NOT select it: the editor loads it after navigation, and until then it
       * still holds the previous note's draft, which it saves first (see NoteEditorComponent.load).
       */
      async createNote(notebookId: string | null = null): Promise<Note | null> {
        try {
          const note = await firstValueFrom(
            api.create({ title: 'Untitled', content: '', ...(notebookId ? { notebookId } : {}) }),
          );
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
          patchState(store, {
            selected: updated,
            notes: store.notes().map((n) => (n.id === id ? toSummary(updated) : n)),
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

      /**
       * Changes notebook, pin and tags of ANY note in the list (the open one or not).
       * When it is the open note, only those fields (and the version) are merged into `selected`:
       * the editor's unsaved title/content must not be touched, and the server's reply carries
       * the last SAVED text, which would overwrite the draft.
       */
      async updateOrganization(id: string, change: NoteOrganization): Promise<OrganizationResult> {
        const selected = store.selected();
        const isOpen = selected?.id === id;
        // The version we last saw: from the open note, or from the list for any other note.
        const version = isOpen ? selected.version : store.notes().find((n) => n.id === id)?.version;
        if (version === undefined) {
          return 'error';
        }

        // For the open note, `saving` also blocks the editor's autosave while this request runs,
        // so the two cannot race on the same version number.
        if (isOpen) patchState(store, { saving: true });
        try {
          const updated = await firstValueFrom(api.updateOrganization(id, { ...change, version }));
          const organization = {
            version: updated.version,
            notebookId: updated.notebookId,
            isPinned: updated.isPinned,
            status: updated.status,
            tagIds: updated.tagIds,
          };
          const open = store.selected();
          patchState(store, {
            selected: open?.id === id ? { ...open, ...organization } : open,
            notes: store.notes().map((n) => (n.id === id ? { ...n, ...organization } : n)),
            saving: false,
          });
          return 'ok';
        } catch (error) {
          if (isOpen) patchState(store, { saving: false });
          const status = statusOf(error);
          if (status === 409) return 'conflict';
          if (status === 404) return 'not-found';
          if (status === 400) return 'invalid';
          return 'error';
        }
      },

      /**
       * A tag was deleted on the server (which removed it from every note): forget its id here too,
       * otherwise the next organization update would send an id the server no longer knows (400).
       */
      forgetTag(tagId: string): void {
        const without = (ids: string[]) => ids.filter((id) => id !== tagId);
        const open = store.selected();
        patchState(store, {
          notes: store.notes().map((n) => ({ ...n, tagIds: without(n.tagIds) })),
          selected: open ? { ...open, tagIds: without(open.tagIds) } : open,
        });
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
