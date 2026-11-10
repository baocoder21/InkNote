import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideUi } from './core/ui.providers';
import { authInterceptor } from './features/auth/auth.interceptor';
import { AuthStore } from './features/auth/store/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route params (e.g. :id) become component input()s.
    provideRouter(routes, withComponentInputBinding()),
    // The interceptor adds the access token to API calls and renews it when it has expired.
    provideHttpClient(withInterceptors([authInterceptor])),
    provideUi(), // ng-zorro: locale, icons, modal service
    // Before the first page is shown: if this browser has a session, sign in again from the
    // refresh cookie, so a reload does not log the user out (and the route guards know the answer).
    provideAppInitializer(() => inject(AuthStore).restoreSession()),
  ],
};
