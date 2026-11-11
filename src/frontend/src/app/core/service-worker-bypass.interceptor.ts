import { HttpInterceptorFn } from '@angular/common/http';
import { API_BASE_URL } from './api.config';

/** The header the Angular service worker looks for: a request that has it is left to the browser, untouched. */
export const SW_BYPASS_HEADER = 'ngsw-bypass';

/**
 * Keeps our API requests away from the service worker.
 *
 * Once a service worker controls the page, EVERY request of the page passes through it, the API calls too. It serves
 * the files of the app from its cache, and for anything else it fetches from the network itself. If that fails (the
 * network is down) it does not give the app the real error: it makes up a "504 Gateway Timeout". The app would then
 * see a broken server instead of "no connection": the status line would say "Sync problem" instead of "Offline", and
 * a failed token refresh would look like a refused session.
 *
 * The data of the app has its own strategy (the local database and the outbox), so the service worker has no business
 * with the API. With this header the request goes straight to the network, as if there were no service worker, and a
 * lost connection is reported as what it is.
 */
export const bypassServiceWorker: HttpInterceptorFn = (request, next) =>
  request.url.startsWith(API_BASE_URL) ? next(request.clone({ setHeaders: { [SW_BYPASS_HEADER]: 'true' } })) : next(request);
