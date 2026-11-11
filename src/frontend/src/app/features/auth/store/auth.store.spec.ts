import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HARD_NAVIGATE } from '../../../core/page-navigation';
import { AuthResponse } from '../models/auth.model';
import { AUTH_URL } from '../services/auth-api.service';
import { AuthStore } from './auth.store';

const response = (token = 'access-1', email = 'ann@example.com'): AuthResponse => ({
  accessToken: token,
  expiresInSeconds: 900,
  user: { id: 'u1', email },
});
const CREDENTIALS = { email: 'ann@example.com', password: 'correct horse battery', rememberMe: false };

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;
  let http: HttpTestingController;
  let navigated: string[];

  beforeEach(() => {
    localStorage.clear();
    navigated = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: HARD_NAVIGATE, useValue: (url: string) => navigated.push(url) },
      ],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('login', () => {
    it('keeps the user and the access token in memory, and sends the cookie-enabled request', async () => {
      const result = store.login(CREDENTIALS);
      const request = http.expectOne(`${AUTH_URL}/login`);
      expect(request.request.body).toEqual(CREDENTIALS);
      expect(request.request.withCredentials).toBe(true); // otherwise the refresh cookie is not accepted
      request.flush(response());

      expect(await result).toEqual({ status: 'ok' });
      expect(store.isSignedIn()).toBe(true);
      expect(store.user()?.email).toBe('ann@example.com');
      expect(store.accessToken()).toBe('access-1');
    });

    it('never writes the access token to storage (only a harmless "has a session" hint)', async () => {
      const result = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response('secret-access-token'));
      await result;

      const stored = JSON.stringify({ ...localStorage });
      expect(stored).not.toContain('secret-access-token');
      expect(localStorage.getItem('inknote.session')).toBe('1');
    });

    it('answers "invalid" for a wrong password and leaves the store signed out', async () => {
      const result = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush({ title: 'Invalid email or password.' }, { status: 401, statusText: 'Unauthorized' });

      expect(await result).toEqual({ status: 'invalid' });
      expect(store.isSignedIn()).toBe(false);
      expect(store.accessToken()).toBeNull();
    });

    it('tells a rate limit / locked account (429) from other failures (500)', async () => {
      const limited = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush('', { status: 429, statusText: 'Too Many Requests' });
      expect(await limited).toEqual({ status: 'too-many' });

      const broken = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush('', { status: 500, statusText: 'Server Error' });
      expect(await broken).toEqual({ status: 'error' });
    });
  });

  describe('register', () => {
    it('signs the new user in', async () => {
      const result = store.register(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/register`).flush(response(), { status: 201, statusText: 'Created' });

      expect(await result).toEqual({ status: 'ok' });
      expect(store.isSignedIn()).toBe(true);
    });

    it('reports a taken email (409)', async () => {
      const result = store.register(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/register`).flush({}, { status: 409, statusText: 'Conflict' });

      expect(await result).toEqual({ status: 'duplicate' });
    });

    it('passes on the reasons the server gives for a rejected password (400)', async () => {
      const result = store.register(CREDENTIALS);
      http
        .expectOne(`${AUTH_URL}/register`)
        .flush({ errors: { password: ['Passwords must be at least 8 characters.'] } }, { status: 400, statusText: 'Bad Request' });

      expect(await result).toEqual({ status: 'invalid', fieldErrors: { password: ['Passwords must be at least 8 characters.'] } });
    });
  });

  describe('refresh', () => {
    it('gives every caller the same new token from ONE request (the refresh token is single use)', async () => {
      const a = store.refresh();
      const b = store.refresh();
      const c = store.refresh();

      http.expectOne(`${AUTH_URL}/refresh`).flush(response('access-2')); // expectOne: exactly one request was sent

      expect(await Promise.all([a, b, c])).toEqual(['access-2', 'access-2', 'access-2']);
      expect(store.accessToken()).toBe('access-2');
    });

    it('can refresh again later (the shared request is forgotten once done)', async () => {
      const first = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).flush(response('access-2'));
      await first;

      const second = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).flush(response('access-3'));
      expect(await second).toBe('access-3');
    });

    it('rejects, and keeps the session, when the server cannot be reached (offline is not "signed out")', async () => {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;

      const refreshed = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).error(new ProgressEvent('error')); // status 0: it never arrived

      await expect(refreshed).rejects.toBeDefined();
      expect(store.isSignedIn()).toBe(true);
      expect(localStorage.getItem('inknote.session')).toBe('1');
      expect(localStorage.getItem('inknote.user')).not.toBeNull();
    });

    it.each([
      [500, 'Internal Server Error'],
      [502, 'Bad Gateway'],
      [503, 'Service Unavailable'],
      [504, 'Gateway Timeout'], // what a service worker or a proxy makes up when the network is down
      [429, 'Too Many Requests'],
    ])('a %i from the refresh is "no answer", not "session refused": the user stays signed in', async (status, statusText) => {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;

      const refreshed = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status, statusText });

      await expect(refreshed).rejects.toBeDefined();
      expect(store.isSignedIn()).toBe(true);
      expect(localStorage.getItem('inknote.session')).toBe('1');
    });

    it.each([400, 401, 403])('a %i from the refresh IS the server\'s verdict: the session ends', async (status) => {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;

      const refreshed = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status, statusText: 'No' });

      expect(await refreshed).toBeNull();
      expect(store.isSignedIn()).toBe(false);
    });

    it('resolves to null and forgets the session when the server refuses', async () => {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;

      const refreshed = store.refresh();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(await refreshed).toBeNull();
      expect(store.isSignedIn()).toBe(false);
      expect(store.accessToken()).toBeNull();
      expect(localStorage.getItem('inknote.session')).toBeNull();
    });
  });

  describe('restoreSession (runs before the first page)', () => {
    it('asks the server nothing when this browser has no session hint (a first-time visitor)', async () => {
      expect(await store.restoreSession()).toBe(false);

      http.expectNone(`${AUTH_URL}/refresh`);
    });

    it('signs the user in again from the cookie when there is a hint', async () => {
      localStorage.setItem('inknote.session', '1');
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).flush(response('access-9'));

      expect(await restored).toBe(true);
      expect(store.user()?.email).toBe('ann@example.com');
    });

    it('retries once after a short pause (two tabs starting together race for the single-use token)', async () => {
      localStorage.setItem('inknote.session', '1');
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });

      // Not immediately: the retry waits a moment so the other tab's new cookie has arrived.
      http.expectNone(`${AUTH_URL}/refresh`);
      const retry = await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`));
      retry.flush(response('access-10'));

      expect(await restored).toBe(true);
    });

    it('gives up after the retry, forgets the hint, and stays signed out', async () => {
      localStorage.setItem('inknote.session', '1');
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });
      (await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`))).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(await restored).toBe(false);
      expect(store.isSignedIn()).toBe(false);
      expect(localStorage.getItem('inknote.session')).toBeNull(); // the next visit does not even try
    });
  });

  describe('restoreSession while offline (the app must start from the data on this device)', () => {
    // What an earlier visit left in this browser: a session hint and who it was (no secrets).
    const earlierVisit = () => {
      localStorage.setItem('inknote.session', '1');
      localStorage.setItem('inknote.user', JSON.stringify({ id: 'u1', email: 'ann@example.com' }));
    };

    it('carries on as the user this browser knows when the server cannot be reached', async () => {
      earlierVisit();
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).error(new ProgressEvent('error'));

      expect(await restored).toBe(true);
      expect(store.user()).toEqual({ id: 'u1', email: 'ann@example.com' });
      expect(store.accessToken()).toBeNull(); // renewed later, when the network answers
      expect(localStorage.getItem('inknote.session')).toBe('1'); // the session is not forgotten
      http.expectNone(`${AUTH_URL}/refresh`); // and a network error is not retried after a pause
    });

    it('also starts as the known user when the refresh answers with a made-up 504 (a service worker offline)', async () => {
      earlierVisit();
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).flush('', { status: 504, statusText: 'Gateway Timeout' });

      expect(await restored).toBe(true);
      expect(store.user()?.email).toBe('ann@example.com');
      http.expectNone(`${AUTH_URL}/refresh`); // no retry after a pause either
    });

    it('cannot start offline when this browser does not know who the user is', async () => {
      localStorage.setItem('inknote.session', '1');
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).error(new ProgressEvent('error'));

      expect(await restored).toBe(false);
      expect(store.isSignedIn()).toBe(false);
    });

    it('ignores a damaged "who" record', async () => {
      localStorage.setItem('inknote.session', '1');
      localStorage.setItem('inknote.user', '{not json');
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).error(new ProgressEvent('error'));

      expect(await restored).toBe(false);
    });

    it('a refused session (not a network problem) still ends the session and forgets who it was', async () => {
      earlierVisit();
      const restored = store.restoreSession();
      http.expectOne(`${AUTH_URL}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });
      (await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`))).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(await restored).toBe(false);
      expect(localStorage.getItem('inknote.user')).toBeNull();
    });

    it('signing out forgets who the user was (the next person on this computer must not be taken for them)', async () => {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;
      expect(localStorage.getItem('inknote.user')).not.toBeNull();

      const done = store.logout();
      http.expectOne(`${AUTH_URL}/logout`).flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(localStorage.getItem('inknote.user')).toBeNull();
    });
  });

  describe('logout and expiry', () => {
    async function signedIn() {
      const login = store.login(CREDENTIALS);
      http.expectOne(`${AUTH_URL}/login`).flush(response());
      await login;
    }

    it('tells the server, forgets everything and reloads at the login page', async () => {
      await signedIn();

      const done = store.logout();
      const request = http.expectOne(`${AUTH_URL}/logout`);
      expect(request.request.withCredentials).toBe(true);
      request.flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(store.isSignedIn()).toBe(false);
      expect(store.accessToken()).toBeNull();
      expect(localStorage.getItem('inknote.session')).toBeNull();
      expect(navigated).toEqual(['/login']); // a FULL page load: nothing of this user stays in memory
    });

    it('still signs out here when the server cannot be reached', async () => {
      await signedIn();

      const done = store.logout();
      http.expectOne(`${AUTH_URL}/logout`).error(new ProgressEvent('error'));
      await done;

      expect(store.isSignedIn()).toBe(false);
      expect(navigated).toEqual(['/login']);
    });

    it('sessionExpired remembers where the user was', async () => {
      await signedIn();
      await TestBed.inject(Router).navigateByUrl('/notes/42?tag=x');

      store.sessionExpired();

      expect(store.isSignedIn()).toBe(false);
      expect(navigated).toEqual([`/login?returnUrl=${encodeURIComponent('/notes/42?tag=x')}`]);
    });
  });
});
