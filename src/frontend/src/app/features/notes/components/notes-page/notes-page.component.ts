import { ChangeDetectionStrategy, Component, OnInit, inject, input } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { NotesSidebarComponent } from '../notes-sidebar/notes-sidebar.component';

/**
 * "Container" component: the layout (sidebar | open note) and the initial loading.
 *
 * The tag filter lives in the URL: /notes?tag=<id>. Angular copies query parameters into inputs
 * with the same name (withComponentInputBinding), so reloading the page or sharing the link
 * keeps the filter, and the Back button steps through filters.
 */
@Component({
  selector: 'app-notes-page',
  imports: [RouterOutlet, NotesSidebarComponent],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPageComponent implements OnInit {
  readonly tag = input<string>(); // ?tag=...

  private readonly store = inject(NotesStore);
  private readonly org = inject(OrganizationStore);
  private readonly message = inject(NzMessageService);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    // Both start now and run in parallel.
    const [notesOk, orgOk] = await Promise.all([this.store.loadNotes(), this.org.load()]);
    if (!notesOk) {
      this.message.error('Cannot load notes. Is the backend running on port 5032?');
    } else if (!orgOk) {
      this.message.error('Cannot load folders and tags');
    }
  }
}
