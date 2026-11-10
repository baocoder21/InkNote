import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Note, NoteSummary } from '../models/note.model';
import { NotesApi } from '../services/notes-api.service';

interface TrashState {
  items: NoteSummary[]; // deleted notes, most recently deleted first (updatedAt = deletion time)
  selected: Note | null; // the trashed note being looked at (with content)
  loading: boolean;
  loadingSelected: boolean;
}

const initialState: TrashState = { items: [], selected: null, loading: false, loadingSelected: false };

// 'not-found' = it is not in the trash any more (already restored or purged somewhere else).
export type TrashResult = 'ok' | 'not-found' | 'error';

/**
 * The trash: notes that were deleted but can still be brought back. Separate from NotesStore
 * (the live notes) so a deleted note can never show up in the sidebar by accident. The trash lives on the
 * server only; the page that restores a note starts a synchronization so the note comes back to this device.
 */
export const TrashStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, api = inject(NotesApi)) => {
    // Not state: the most recent select() request, so a slow answer for note A cannot replace B.
    let latestSelectedId: string | null = null;

    const forget = (id: string) =>
      patchState(store, {
        items: store.items().filter((n) => n.id !== id),
        selected: store.selected()?.id === id ? null : store.selected(),
      });

    return {
      async load(): Promise<boolean> {
        patchState(store, { loading: true });
        try {
          const items = await firstValueFrom(api.listTrash());
          // The note being looked at may have left the trash in the meantime.
          const selected = items.some((n) => n.id === store.selected()?.id) ? store.selected() : null;
          patchState(store, { items, selected, loading: false });
          return true;
        } catch {
          patchState(store, { loading: false });
          return false;
        }
      },

      async select(id: string): Promise<TrashResult> {
        latestSelectedId = id;
        patchState(store, { selected: null, loadingSelected: true });
        try {
          const note = await firstValueFrom(api.getTrashed(id));
          if (latestSelectedId === id) {
            patchState(store, { selected: note, loadingSelected: false });
          }
          return 'ok';
        } catch (error) {
          if (latestSelectedId === id) {
            patchState(store, { loadingSelected: false });
          }
          return error instanceof HttpErrorResponse && error.status === 404 ? 'not-found' : 'error';
        }
      },

      clearSelection(): void {
        latestSelectedId = null;
        patchState(store, { selected: null, loadingSelected: false });
      },

      /** Takes the note out of the trash. The caller reloads the live notes. */
      async restore(id: string): Promise<TrashResult> {
        try {
          await firstValueFrom(api.restore(id));
          forget(id);
          return 'ok';
        } catch (error) {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            forget(id); // it is not in the trash any more: stop listing it
            return 'not-found';
          }
          return 'error';
        }
      },

      /** Deletes one note from the database for good. */
      async purge(id: string): Promise<TrashResult> {
        try {
          await firstValueFrom(api.purge(id));
          forget(id);
          return 'ok';
        } catch (error) {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            forget(id);
            return 'not-found';
          }
          return 'error';
        }
      },

      /** Deletes everything in the trash for good. Returns how many notes went, or null on error. */
      async empty(): Promise<number | null> {
        try {
          const { deleted } = await firstValueFrom(api.emptyTrash());
          latestSelectedId = null;
          patchState(store, { items: [], selected: null, loadingSelected: false });
          return deleted;
        } catch {
          return null;
        }
      },
    };
  }),
);
