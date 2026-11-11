import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api.config';
import { SW_BYPASS_HEADER, bypassServiceWorker } from './service-worker-bypass.interceptor';

describe('bypassServiceWorker', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([bypassServiceWorker])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('uses the header name the Angular service worker understands', () => {
    expect(SW_BYPASS_HEADER).toBe('ngsw-bypass');
  });

  it('marks every request to our API (any method), so the service worker leaves it to the network', () => {
    http.get(`${API_BASE_URL}/api/notes`).subscribe();
    http.post(`${API_BASE_URL}/api/sync/push`, {}).subscribe();

    const requests = controller.match(() => true);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.request.headers.get(SW_BYPASS_HEADER)).toBe('true');
    }
  });

  it('leaves requests to other addresses alone (the service worker may serve those)', () => {
    http.get('/assets/something.json').subscribe();
    http.get('https://example.com/data').subscribe();

    for (const request of controller.match(() => true)) {
      expect(request.request.headers.has(SW_BYPASS_HEADER)).toBe(false);
    }
  });

  it('keeps the other headers of the request', () => {
    http.get(`${API_BASE_URL}/api/notes`, { headers: { 'X-Test': '1' } }).subscribe();

    const request = controller.expectOne(`${API_BASE_URL}/api/notes`);

    expect(request.request.headers.get('X-Test')).toBe('1');
    expect(request.request.headers.get(SW_BYPASS_HEADER)).toBe('true');
  });
});
