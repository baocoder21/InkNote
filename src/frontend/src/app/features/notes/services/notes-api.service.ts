import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import {
  CreateNoteRequest,
  Note,
  NoteSummary,
  UpdateNoteOrganizationRequest,
  UpdateNoteRequest,
} from '../models/note.model';
import { NoteRevision, NoteRevisionSummary } from '../models/revision.model';
import { SearchResponse } from '../models/search.model';

/** Thin wrapper over the backend REST API. It only does HTTP: no state, no UI logic. */
@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/api/notes`;

  // The server can also filter (?notebookId=, ?tagId=) but the sidebar groups and filters the
  // full list itself, so this always asks for everything.
  list(): Observable<NoteSummary[]> {
    return this.http.get<NoteSummary[]>(this.url);
  }

  get(id: string): Observable<Note> {
    return this.http.get<Note>(`${this.url}/${id}`);
  }

  create(request: CreateNoteRequest): Observable<Note> {
    return this.http.post<Note>(this.url, request);
  }

  update(id: string, request: UpdateNoteRequest): Observable<Note> {
    return this.http.put<Note>(`${this.url}/${id}`, request);
  }

  updateOrganization(id: string, request: UpdateNoteOrganizationRequest): Observable<Note> {
    return this.http.put<Note>(`${this.url}/${id}/organization`, request);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  /** Full-text search. The server pages the results (20 per page by default). */
  search(query: string, options: { tagId?: string | null; page?: number } = {}): Observable<SearchResponse> {
    let params = new HttpParams().set('q', query).set('page', options.page ?? 1);
    if (options.tagId) {
      params = params.set('tagId', options.tagId);
    }
    return this.http.get<SearchResponse>(`${this.url}/search`, { params });
  }

  // ---- History (the older texts the server keeps of a note; there is no copy on the device) ----

  revisions(id: string): Observable<NoteRevisionSummary[]> {
    return this.http.get<NoteRevisionSummary[]>(`${this.url}/${id}/revisions`);
  }

  revision(id: string, revisionId: string): Observable<NoteRevision> {
    return this.http.get<NoteRevision>(`${this.url}/${id}/revisions/${revisionId}`);
  }

  /** Puts an older text back (the server keeps the one it replaces). Answers with the note as it is now. */
  restoreRevision(id: string, revisionId: string): Observable<Note> {
    return this.http.post<Note>(`${this.url}/${id}/revisions/${revisionId}/restore`, null);
  }

  // ---- Trash (notes deleted with delete(), which only hides them) ----

  listTrash(): Observable<NoteSummary[]> {
    return this.http.get<NoteSummary[]>(`${this.url}/trash`);
  }

  /** A deleted note with its content, to look at it before restoring. */
  getTrashed(id: string): Observable<Note> {
    return this.http.get<Note>(`${this.url}/trash/${id}`);
  }

  restore(id: string): Observable<Note> {
    return this.http.post<Note>(`${this.url}/trash/${id}/restore`, null);
  }

  /** Removes one trashed note from the database for good. */
  purge(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/trash/${id}`);
  }

  /** Removes every trashed note for good; answers how many. */
  emptyTrash(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.url}/trash`);
  }
}
