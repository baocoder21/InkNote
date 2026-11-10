import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';
import { AuthResponse, Credentials } from '../models/auth.model';

export const AUTH_URL = `${API_BASE_URL}/api/auth`;

/**
 * Thin wrapper over the /api/auth endpoints. `withCredentials: true` makes the browser send and
 * accept cookies on these cross-origin calls: the refresh token cookie is how a session survives
 * a page reload. (Other API calls do not need cookies, only the Bearer header.)
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(credentials: Credentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${AUTH_URL}/register`, credentials, { withCredentials: true });
  }

  login(credentials: Credentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${AUTH_URL}/login`, credentials, { withCredentials: true });
  }

  /** No body: the refresh token is in the cookie. */
  refresh(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${AUTH_URL}/refresh`, null, { withCredentials: true });
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${AUTH_URL}/logout`, null, { withCredentials: true });
  }
}
