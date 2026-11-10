import { Routes } from '@angular/router';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NoteEditorComponent } from './components/note-editor/note-editor.component';
import { NoteEmptyComponent } from './components/note-empty/note-empty.component';
import { NotesPageComponent } from './components/notes-page/notes-page.component';

export const NOTES_ROUTES: Routes = [
  {
    path: '',
    // Only this feature opens dialogs and right-click menus, so these services are provided here
    // (in the lazily loaded chunk) instead of in the app-wide providers: the first page load
    // does not have to download the modal and dropdown code.
    providers: [NzModalService, NzContextMenuService],
    component: NotesPageComponent, // sidebar + a <router-outlet> for the right-hand pane
    children: [
      { path: '', component: NoteEmptyComponent }, // /notes
      { path: ':id', component: NoteEditorComponent }, // /notes/<id> -> input `id`
    ],
  },
];
