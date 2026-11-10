import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import { Notebook, Tag } from '../models/organization.model';

/** HTTP calls for notebooks and tags. Like NotesApi: no state, no UI logic. */
@Injectable({ providedIn: 'root' })
export class OrganizationApi {
  private readonly http = inject(HttpClient);
  private readonly notebooksUrl = `${API_BASE_URL}/api/notebooks`;
  private readonly tagsUrl = `${API_BASE_URL}/api/tags`;

  listNotebooks(): Observable<Notebook[]> {
    return this.http.get<Notebook[]>(this.notebooksUrl);
  }

  createNotebook(name: string, parentId: string | null): Observable<Notebook> {
    return this.http.post<Notebook>(this.notebooksUrl, { name, parentId });
  }

  // The same endpoint renames and moves, so it always needs both fields.
  updateNotebook(id: string, name: string, parentId: string | null): Observable<Notebook> {
    return this.http.put<Notebook>(`${this.notebooksUrl}/${id}`, { name, parentId });
  }

  deleteNotebook(id: string): Observable<void> {
    return this.http.delete<void>(`${this.notebooksUrl}/${id}`);
  }

  listTags(): Observable<Tag[]> {
    return this.http.get<Tag[]>(this.tagsUrl);
  }

  createTag(name: string): Observable<Tag> {
    return this.http.post<Tag>(this.tagsUrl, { name });
  }

  deleteTag(id: string): Observable<void> {
    return this.http.delete<void>(`${this.tagsUrl}/${id}`);
  }
}
