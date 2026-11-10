import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { HARD_NAVIGATE } from '../../core/page-navigation';
import { authInterceptor } from './auth.interceptor';
import { AuthResponse } from './models/auth.model';
import { AUTH_URL } from './services/auth-api.service';
import { AuthStore } from './store/auth.store';

const NOTES = `${API_BASE_URL}/api/notes`;
const tokenResponse = (token: string): AuthResponse => ({ accessToken: token, expiresInSeconds: 900, user: { id: 'u1', email: 'a@b.c' } });
const UNAUTHORIZED = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let store: InstanceType<typeof AuthStore>;
  let navigated: string[];

  beforeEach(async () => {
    localStorage.clear();
    navigated = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: HARD_NAVIGATE, useValue: (url: string) => navigated.push(url) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    store = TestBed.inject(AuthStore);

    // Signed in with an access token that the server will later call expired.
    const login = store.login({ email: 'a@b.c', password: 'whatever whatever', rememberMe: false });
    http.expectOne(`${AUTH_URL}/login`).flush(tokenResponse('old-token'));
    await login;
  });

  afterEach(() => http.verify());

  it('adds the access token as a Bearer header to API calls', async () => {
    const result = firstValueFrom(client.get(NOTES));

    const request = http.expectOne(NOTES);
    expect(request.request.headers.get('Authorization')).toBe('Bearer old-token');
    request.flush([]);
    await result;
  });

  it('sends no Bearer header to the auth endpoints', async () => {
    const result = firstValueFrom(client.post(`${AUTH_URL}/refresh`, null));

    const request = http.expectOne(`${AUTH_URL}/refresh`);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(tokenResponse('x'));
    await result;
  });

  it('does not leak the token to a foreign host', async () => {
    const result = firstValueFrom(client.get('https://other.example/data'));

    const request = http.expectOne('https://other.example/data');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
    await result;
  });

  it('on 401 gets a new token with the refresh cookie and repeats the SAME request once', async () => {
    const result = firstValueFrom(client.get<string[]>(NOTES));

    http.expectOne(NOTES).flush({}, UNAUTHORIZED); // the access token has expired
    await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`).flush(tokenResponse('new-token')));
    const retry = await vi.waitFor(() => http.expectOne(NOTES));
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-token');
    retry.flush(['note']);

    expect(await result).toEqual(['note']); // the caller never saw the 401
    expect(store.accessToken()).toBe('new-token');
  });

  it('several requests failing together share ONE refresh and are all repeated', async () => {
    const a = firstValueFrom(client.get<string>(`${NOTES}/a`));
    const b = firstValueFrom(client.get<string>(`${NOTES}/b`));
    http.expectOne(`${NOTES}/a`).flush({}, UNAUTHORIZED);
    http.expectOne(`${NOTES}/b`).flush({}, UNAUTHORIZED);

    await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`).flush(tokenResponse('new-token'))); // exactly one
    (await vi.waitFor(() => http.expectOne(`${NOTES}/a`))).flush('A');
    (await vi.waitFor(() => http.expectOne(`${NOTES}/b`))).flush('B');

    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
  });

  it('when the refresh fails the session is over: the error reaches the caller and the login page opens', async () => {
    const result = firstValueFrom(client.get(NOTES)).then(
      () => 'ok',
      (error) => error.status,
    );

    http.expectOne(NOTES).flush({}, UNAUTHORIZED);
    await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`).flush({}, UNAUTHORIZED));

    expect(await result).toBe(401);
    expect(store.isSignedIn()).toBe(false);
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain('/login');
  });

  it('repeats only once: a second 401 goes to the caller without another refresh', async () => {
    const result = firstValueFrom(client.get(NOTES)).then(
      () => 'ok',
      (error) => error.status,
    );

    http.expectOne(NOTES).flush({}, UNAUTHORIZED);
    await vi.waitFor(() => http.expectOne(`${AUTH_URL}/refresh`).flush(tokenResponse('new-token')));
    (await vi.waitFor(() => http.expectOne(NOTES))).flush({}, UNAUTHORIZED); // still refused (e.g. no permission)

    expect(await result).toBe(401);
    http.expectNone(`${AUTH_URL}/refresh`); // no loop
  });

  it('leaves other errors alone (no refresh for a 404 or a 500)', async () => {
    const notFound = firstValueFrom(client.get(NOTES)).then(() => 'ok', (e) => e.status);
    http.expectOne(NOTES).flush({}, { status: 404, statusText: 'Not Found' });
    expect(await notFound).toBe(404);

    const broken = firstValueFrom(client.get(NOTES)).then(() => 'ok', (e) => e.status);
    http.expectOne(NOTES).flush({}, { status: 500, statusText: 'Server Error' });
    expect(await broken).toBe(500);

    http.expectNone(`${AUTH_URL}/refresh`);
  });

  it('a failed login (401) is NOT treated as an expired session', async () => {
    const result = firstValueFrom(client.post(`${AUTH_URL}/login`, {})).then(() => 'ok', (e) => e.status);

    http.expectOne(`${AUTH_URL}/login`).flush({}, UNAUTHORIZED);

    expect(await result).toBe(401);
    http.expectNone(`${AUTH_URL}/refresh`);
    expect(navigated).toEqual([]);
  });
});
