import { Routes } from '@angular/router';
import { NoteEditorComponent } from './components/note-editor/note-editor.component';
import { NoteEmptyComponent } from './components/note-empty/note-empty.component';
import { NotesPageComponent } from './components/notes-page/notes-page.component';

export const NOTES_ROUTES: Routes = [
  {
    path: '',
    component: NotesPageComponent, // sidebar + a <router-outlet> for the right-hand pane
    children: [
      { path: '', component: NoteEmptyComponent }, // /notes
      { path: ':id', component: NoteEditorComponent }, // /notes/<id> -> input `id`
    ],
  },
];
