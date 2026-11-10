import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { API_BASE_URL } from './core/api.config';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows "API OK" when the health endpoint succeeds', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    http
      .expectOne(`${API_BASE_URL}/api/health`)
      .flush({ status: 'OK', service: 'InkNote.Api', time: '2026-01-01T00:00:00Z' });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('API OK');
  });

  it('shows an error message when the health endpoint fails', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    http
      .expectOne(`${API_BASE_URL}/api/health`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Cannot reach the API');
  });
});
