import { HttpClient } from '@angular/common/http';
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
}
