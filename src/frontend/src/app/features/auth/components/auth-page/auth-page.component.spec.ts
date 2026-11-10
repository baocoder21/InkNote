import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideUi } from '../../../../core/ui.providers';
import { AUTH_URL } from '../../services/auth-api.service';
import { AuthStore } from '../../store/auth.store';
import { AuthPageComponent } from './auth-page.component';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const OK = { accessToken: 'token', expiresInSeconds: 900, user: { id: 'u1', email: 'ann@example.com' } };

describe('AuthPageComponent', () => {
  let fixture: ComponentFixture<AuthPageComponent>;
  let http: HttpTestingController;
  let router: Router;
  const el = () => fixture.nativeElement as HTMLElement;
  const input = (type: string, nth = 0) => el().querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)[nth];
  const button = () => el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const errors = () => Array.from(el().querySelectorAll('.error')).map((e) => e.textContent!.trim());

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  }

  async function show(mode: 'login' | 'register', returnUrl?: string) {
    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.componentRef.setInput('mode', mode);
    if (returnUrl !== undefined) fixture.componentRef.setInput('returnUrl', returnUrl);
    await settle();
  }

  function type(field: HTMLInputElement, text: string) {
    field.value = text;
    field.dispatchEvent(new Event('input'));
  }

  const submit = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }]), provideUi()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('sign in', () => {
    it('has email and password fields, the right autocomplete hints and a link to register', async () => {
      await show('login');

      expect(el().textContent).toContain('Sign in');
      expect(input('email').getAttribute('autocomplete')).toBe('username');
      expect(input('password').getAttribute('autocomplete')).toBe('current-password');
      expect(el().querySelectorAll('input[type="password"]')).toHaveLength(1); // no "repeat" field
      expect(el().querySelector('a')!.getAttribute('href')).toContain('/register');
    });

    it('has a "keep me signed in" checkbox that is OFF by default (the safe choice on a shared computer)', async () => {
      await show('login');

      const box = el().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(box.checked).toBe(false);
      expect(el().querySelector('.remember')!.textContent).toContain('Keep me signed in');
      expect(el().querySelector('.remember')!.textContent).toContain('30 days');
    });

    it('sends rememberMe: true when the box is ticked', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');
      const box = el().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      box.click(); // a real click: toggles the checkbox and fires "change"
      await settle();

      await submit();

      const request = http.expectOne(`${AUTH_URL}/login`);
      expect(request.request.body).toEqual({ email: 'ann@example.com', password: 'correct horse battery', rememberMe: true });
      request.flush(OK);
      await settle();
    });

    it('sends nothing and explains what is missing when the form is empty', async () => {
      await show('login');

      await submit();

      http.expectNone(`${AUTH_URL}/login`);
      expect(errors()).toEqual(['Enter your email.', 'Enter your password.']);
    });

    it('does not judge the length of a password on the login page (a wrong one is simply wrong)', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'abc');

      await submit();

      http.expectOne(`${AUTH_URL}/login`).flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('signs in and goes to the notes', async () => {
      await show('login');
      const navigate = vi.spyOn(router, 'navigateByUrl');
      type(input('email'), '  ann@example.com ');
      type(input('password'), 'correct horse battery');

      await submit();
      const request = http.expectOne(`${AUTH_URL}/login`);
      expect(request.request.body).toEqual({ email: 'ann@example.com', password: 'correct horse battery', rememberMe: false }); // email trimmed
      request.flush(OK);
      await settle();

      expect(TestBed.inject(AuthStore).isSignedIn()).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/notes');
    });

    it('goes back to where the user was heading (?returnUrl=)', async () => {
      await show('login', '/notes/42?tag=x');
      const navigate = vi.spyOn(router, 'navigateByUrl');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');

      await submit();
      http.expectOne(`${AUTH_URL}/login`).flush(OK);
      await settle();

      expect(navigate).toHaveBeenCalledWith('/notes/42?tag=x');
    });

    it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)'])(
      'ignores a returnUrl that leaves the app (%s)',
      async (evil) => {
        await show('login', evil);
        const navigate = vi.spyOn(router, 'navigateByUrl');
        type(input('email'), 'ann@example.com');
        type(input('password'), 'correct horse battery');

        await submit();
        http.expectOne(`${AUTH_URL}/login`).flush(OK);
        await settle();

        expect(navigate).toHaveBeenCalledWith('/notes');
      },
    );

    it('shows one message for a wrong email or password, and lets the user try again', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'wrong wrong');

      await submit();
      http.expectOne(`${AUTH_URL}/login`).flush({}, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(errors()).toEqual(['Invalid email or password.']);
      expect(button().disabled).toBe(false);
      expect(TestBed.inject(AuthStore).isSignedIn()).toBe(false);
    });

    it('disables the button while the request runs, so a double click sends one request', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');

      await submit();
      expect(button().disabled).toBe(true);
      await submit(); // a second submit while waiting
      http.expectOne(`${AUTH_URL}/login`).flush(OK); // expectOne = exactly one request was sent
      await settle();
    });

    it('explains a rate limit', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'whatever whatever');

      await submit();
      http.expectOne(`${AUTH_URL}/login`).flush('', { status: 429, statusText: 'Too Many Requests' });
      await settle();

      expect(errors()[0]).toContain('Too many attempts');
    });

    it('says so when the server cannot be reached', async () => {
      await show('login');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'whatever whatever');

      await submit();
      http.expectOne(`${AUTH_URL}/login`).error(new ProgressEvent('error'));
      await settle();

      expect(errors()[0]).toContain('Cannot reach the server');
    });
  });

  describe('register', () => {
    it('asks for the password twice, hints at the rule and has new-password autocomplete', async () => {
      await show('register');

      expect(el().textContent).toContain('Create your account');
      expect(el().querySelectorAll('input[type="password"]')).toHaveLength(2);
      expect(input('password').getAttribute('autocomplete')).toBe('new-password');
      expect(el().textContent).toContain('At least 8 characters');
    });

    it('refuses a short password and mismatching repeats before asking the server', async () => {
      await show('register');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'short');
      type(input('password', 1), 'different');

      await submit();

      http.expectNone(`${AUTH_URL}/register`);
      expect(errors()).toContain('Use at least 8 characters.');
      expect(errors()).toContain('The passwords do not match.');
    });

    it('creates the account and goes to the notes', async () => {
      await show('register');
      const navigate = vi.spyOn(router, 'navigateByUrl');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');
      type(input('password', 1), 'correct horse battery');

      await submit();
      const request = http.expectOne(`${AUTH_URL}/register`);
      expect(request.request.body).toEqual({ email: 'ann@example.com', password: 'correct horse battery', rememberMe: false }); // no "confirm" sent
      request.flush(OK, { status: 201, statusText: 'Created' });
      await settle();

      expect(navigate).toHaveBeenCalledWith('/notes');
    });

    it('also offers "keep me signed in" and sends the choice with the registration', async () => {
      await show('register');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');
      type(input('password', 1), 'correct horse battery');
      el().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      await settle();

      await submit();

      const request = http.expectOne(`${AUTH_URL}/register`);
      expect(request.request.body.rememberMe).toBe(true);
      request.flush(OK, { status: 201, statusText: 'Created' });
      await settle();
    });

    it('tells the user when the email is already registered', async () => {
      await show('register');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');
      type(input('password', 1), 'correct horse battery');

      await submit();
      http.expectOne(`${AUTH_URL}/register`).flush({}, { status: 409, statusText: 'Conflict' });
      await settle();

      expect(errors()[0]).toContain('already exists');
    });

    it('shows the reasons the server gives for a rejected password', async () => {
      await show('register');
      type(input('email'), 'ann@example.com');
      type(input('password'), 'correct horse battery');
      type(input('password', 1), 'correct horse battery');

      await submit();
      http
        .expectOne(`${AUTH_URL}/register`)
        .flush({ errors: { password: ['Too common.'] } }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(errors()[0]).toBe('Too common.');
    });
  });
});
