import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideUi } from './core/ui.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route params (e.g. :id) become component input()s.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideUi(), // ng-zorro: locale, icons, modal service
  ],
};
