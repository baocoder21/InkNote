import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  {
    path: 'notes',
    // Lazy loading: this feature's code is downloaded only when the user visits /notes.
    loadChildren: () => import('./features/notes/notes.routes').then((m) => m.NOTES_ROUTES),
  },
  { path: '**', redirectTo: 'notes' },
];
