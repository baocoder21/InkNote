import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { HARD_NAVIGATE } from '../../../core/page-navigation';
import { AuthResponse, AuthUser, Credentials } from '../models/auth.model';
import { AuthApi } from '../services/auth-api.service';

interface AuthState {
  user: AuthUser | null;
  // The short-lived access token. It lives ONLY in memory (this signal): never in localStorage,
  // where any script injected into the page could read it. A reload loses it on purpose;
  // restoreSession() gets a new one using the HttpOnly refresh cookie.
  accessToken: string | null;
}

const initialState: AuthState = { user: null, accessToken: null };

/**
 * A hint, not a secret: "this browser probably has a session". It only decides whether the app
 * bothers to ask the server for a session at start-up, so first-time visitors see the login page at
 * once, without a pointless request that is bound to answer 401.
 */
const SESSION_HINT_KEY = 'inknote.session';
// Pause before the one retry of a failed session restore (see restoreSession).
const RESTORE_RETRY_MS = 400;

function hint(value: boolean | null): boolean {
  try {
    if (value === true) localStorage.setItem(SESSION_HINT_KEY, '1');
    else if (value === false) localStorage.removeItem(SESSION_HINT_KEY);
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false; // storage blocked: no hint, the app just starts signed out
  }
}

/**
 * Who this browser last signed in (id and email: not secrets). It lets the app start while OFFLINE: the session
 * cannot be renewed without the server, but the user is known, and their notes are on this device.
 */
const USER_KEY = 'inknote.user';

function cachedUser(value: AuthUser | null | undefined): AuthUser | null {
  try {
    if (value) localStorage.setItem(USER_KEY, JSON.stringify(value));
    else if (value === null) localStorage.removeItem(USER_KEY);
    const stored = localStorage.getItem(USER_KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<AuthUser>) : null;
    return parsed?.id && parsed.email ? { id: parsed.id, email: parsed.email } : null;
  } catch {
    return null;
  }
}

/** The request never reached a server: no network, or the server is down. Not the same as "session refused". */
const isNetworkError = (error: unknown) => error instanceof HttpErrorResponse && error.status === 0;

export type SignInResult =
  | { status: 'ok' }
  // 'invalid' = wrong email/password (login) or fields the server rejected (register: see fieldErrors);
  // 'too-many' = rate limit or locked account; 'error' = the server could not be reached or failed.
  | { status: 'invalid' | 'duplicate' | 'too-many' | 'error'; fieldErrors?: Record<string, string[]> };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Who is signed in. Components read `user()`; the HTTP interceptor reads `accessToken()` and calls
 * `refresh()` when the server says 401.
 */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ user }) => ({ isSignedIn: computed(() => user() !== null) })),
  withMethods((store, api = inject(AuthApi), router = inject(Router), hardNavigate = inject(HARD_NAVIGATE)) => {
    // Not state: the refresh request currently running, shared by everyone who needs it.
    let refreshInFlight: Promise<string | null> | null = null;

    const accept = (response: AuthResponse) => {
      patchState(store, { user: response.user, accessToken: response.accessToken });
      hint(true);
      cachedUser(response.user);
    };

    const clear = () => {
      patchState(store, { user: null, accessToken: null });
      hint(false);
      cachedUser(null);
    };

    const refreshOnce = async (): Promise<string | null> => {
      try {
        const response = await firstValueFrom(api.refresh());
        accept(response);
        return response.accessToken;
      } catch (error) {
        if (isNetworkError(error)) {
          throw error; // the server is not reachable: that says nothing about the session, which stays
        }
        clear();
        return null;
      }
    };

    /**
     * Gets a new access token with the refresh cookie. If several requests get a 401 at the same
     * moment they all call this, and they all share ONE request: the refresh token is single use,
     * so a second parallel request would be treated as token reuse by the server.
     * Resolves to the new access token, or null when there is no valid session any more. Rejects when the server
     * cannot be reached (offline): the session is then neither renewed nor ended.
     */
    const refresh = (): Promise<string | null> => {
      refreshInFlight ??= refreshOnce().finally(() => (refreshInFlight = null));
      return refreshInFlight;
    };

    const send = async (request: () => Promise<AuthResponse>, failure: (e: HttpErrorResponse) => SignInResult) => {
      try {
        accept(await request());
        return { status: 'ok' } as SignInResult;
      } catch (error) {
        return error instanceof HttpErrorResponse ? failure(error) : ({ status: 'error' } as SignInResult);
      }
    };

    return {
      login: (credentials: Credentials): Promise<SignInResult> =>
        send(
          () => firstValueFrom(api.login(credentials)),
          (e) => ({ status: e.status === 401 ? 'invalid' : e.status === 429 ? 'too-many' : 'error' }),
        ),

      register: (credentials: Credentials): Promise<SignInResult> =>
        send(
          () => firstValueFrom(api.register(credentials)),
          (e) => {
            if (e.status === 409) return { status: 'duplicate' };
            if (e.status === 429) return { status: 'too-many' };
            if (e.status === 400) return { status: 'invalid', fieldErrors: e.error?.errors ?? {} };
            return { status: 'error' };
          },
        ),

      refresh,

      /**
       * Runs before the app shows its first page: signs the user in again from the cookie, if any.
       * One retry after a short pause: when two tabs start together, one of them loses the race for
       * the single-use refresh token; by the time of the retry the winner's response has put the NEW
       * cookie in the browser, which the retry then uses.
       */
      async restoreSession(): Promise<boolean> {
        if (!hint(null)) {
          return false;
        }
        try {
          if (await refresh()) {
            return true;
          }
          await sleep(RESTORE_RETRY_MS);
          return (await refresh()) !== null;
        } catch {
          // The server cannot be reached (no network): the session is not over, it just cannot be renewed now.
          // Carry on as the user this browser knows: the app works from the data on this device, and the token is
          // renewed the first time the network answers (the interceptor does it when a request gets a 401).
          const known = cachedUser(undefined);
          if (!known) {
            return false;
          }
          patchState(store, { user: known });
          return true;
        }
      },

      /** Signs out here and on the server (the refresh token stops working), then reloads at the login page. */
      async logout(): Promise<void> {
        try {
          await firstValueFrom(api.logout());
        } catch {
          // Even if the server cannot be reached, this browser forgets the session.
        }
        clear();
        hardNavigate('/login');
      },

      /**
       * The server no longer accepts our session (refresh failed). Forget it and reload at the
       * login page, remembering where the user was so they come back to it after signing in.
       */
      sessionExpired(): void {
        const returnUrl = router.url;
        clear();
        hardNavigate(returnUrl && returnUrl !== '/' ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login');
      },
    };
  }),
);
