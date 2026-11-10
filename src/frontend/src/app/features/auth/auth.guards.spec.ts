import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard, guestGuard } from './auth.guards';
import { AUTH_URL } from './services/auth-api.service';
import { AuthStore } from './store/auth.store';

describe('route guards', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const run = (guard: typeof authGuard, url = '/notes/5?tag=x') =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

  async function signIn() {
    const login = TestBed.inject(AuthStore).login({ email: 'a@b.c', password: 'whatever whatever', rememberMe: false });
    http.expectOne(`${AUTH_URL}/login`).flush({ accessToken: 't', expiresInSeconds: 900, user: { id: 'u', email: 'a@b.c' } });
    await login;
  }

  it('authGuard sends a signed-out visitor to the login page and remembers the wanted url', () => {
    const result = run(authGuard) as UrlTree;

    expect(result.toString()).toBe('/login?returnUrl=%2Fnotes%2F5%3Ftag%3Dx');
  });

  it('authGuard lets a signed-in user through', async () => {
    await signIn();

    expect(run(authGuard)).toBe(true);
  });

  it('guestGuard lets a visitor see the login page', () => {
    expect(run(guestGuard, '/login')).toBe(true);
  });

  it('guestGuard sends a signed-in user on to the app', async () => {
    await signIn();

    expect((run(guestGuard, '/login') as UrlTree).toString()).toBe('/notes');
  });
});
