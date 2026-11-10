import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { AUTH_URL } from './services/auth-api.service';
import { AuthStore } from './store/auth.store';

/**
 * An interceptor sits between the app and the network: every HTTP request passes through it.
 * This one does two things for requests to our API:
 *  1. adds "Authorization: Bearer <access token>" so the server knows who is asking;
 *  2. when the server answers 401 (the access token expired), gets a new token with the refresh
 *     cookie and sends the SAME request again, once. The user never notices.
 * If the refresh fails too, the session is over: back to the login page.
 *
 * The /api/auth calls are left alone (they carry no Bearer token; sign-in does not need one, and a
 * 401 from "login" just means a wrong password, not an expired session).
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE_URL) || request.url.startsWith(AUTH_URL)) {
    return next(request);
  }

  const auth = inject(AuthStore);
  const withToken = (token: string | null) =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(withToken(auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      // All requests that fail at the same moment share one refresh (see AuthStore.refresh).
      return from(auth.refresh()).pipe(
        switchMap((token) => {
          if (token === null) {
            auth.sessionExpired();
            return throwError(() => error);
          }
          // Retried once: if it fails again with 401, that error goes to the caller (no loop).
          return next(withToken(token));
        }),
      );
    }),
  );
};
