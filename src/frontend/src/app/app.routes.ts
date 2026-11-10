import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './features/auth/auth.guards';

const authPage = () =>
  import('./features/auth/components/auth-page/auth-page.component').then((m) => m.AuthPageComponent);

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  // Open to visitors who are NOT signed in (a signed-in user is sent on to the app).
  // `data.mode` becomes the page's `mode` input (withComponentInputBinding).
  { path: 'login', canActivate: [guestGuard], data: { mode: 'login' }, loadComponent: authPage },
  { path: 'register', canActivate: [guestGuard], data: { mode: 'register' }, loadComponent: authPage },
  {
    path: 'notes',
    // Everything in the app needs a signed-in user; the guard sends everyone else to /login.
    canActivate: [authGuard],
    // Lazy loading: this feature's code is downloaded only when the user visits /notes.
    loadChildren: () => import('./features/notes/notes.routes').then((m) => m.NOTES_ROUTES),
  },
  { path: '**', redirectTo: 'notes' },
];
