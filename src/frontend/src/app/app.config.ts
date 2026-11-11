import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { bypassServiceWorker } from './core/service-worker-bypass.interceptor';
import { provideUi } from './core/ui.providers';
import { authInterceptor } from './features/auth/auth.interceptor';
import { AuthStore } from './features/auth/store/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route params (e.g. :id) become component input()s.
    provideRouter(routes, withComponentInputBinding()),
    // First: API calls are kept away from the service worker (it would turn "offline" into a fake 504).
    // Then: the access token is added to API calls and renewed when it has expired.
    provideHttpClient(withInterceptors([bypassServiceWorker, authInterceptor])),
    provideUi(), // ng-zorro: locale, icons, modal service
    // Before the first page is shown: if this browser has a session, sign in again from the
    // refresh cookie, so a reload does not log the user out (and the route guards know the answer).
    provideAppInitializer(() => inject(AuthStore).restoreSession()),
    // The service worker keeps the app itself (HTML, JS, CSS) on this device, so the page also loads offline.
    // Only in a production build (`ng serve` has none). It registers once the app has been stable for a moment
    // (or after 30 s at most) so that it never competes with the first load for the network.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
