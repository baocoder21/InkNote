import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import { PullResponse, PushResponse, SyncOperation } from '../models/sync.model';

/** Thin wrapper over /api/sync: only HTTP, no state. */
@Injectable({ providedIn: 'root' })
export class SyncApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/api/sync`;

  push(operations: SyncOperation[]): Observable<PushResponse> {
    return this.http.post<PushResponse>(`${this.url}/push`, { operations });
  }

  pull(cursor: number, limit = 200): Observable<PullResponse> {
    const params = new HttpParams().set('cursor', cursor).set('limit', limit);
    return this.http.get<PullResponse>(`${this.url}/pull`, { params });
  }
}
