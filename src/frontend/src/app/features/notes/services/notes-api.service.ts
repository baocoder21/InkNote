import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import { CreateNoteRequest, Note, NoteSummary, UpdateNoteRequest } from '../models/note.model';

/** Thin wrapper over the backend REST API. It only does HTTP: no state, no UI logic. */
@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/api/notes`;

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

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
