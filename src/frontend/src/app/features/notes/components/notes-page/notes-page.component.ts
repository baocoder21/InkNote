import { ChangeDetectionStrategy, Component, OnInit, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AuthStore } from '../../../auth/store/auth.store';
import { LocalSession } from '../../../sync/local-session.service';
import { SyncEngine } from '../../../sync/sync-engine.service';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { TrashStore } from '../../store/trash.store';
import { NotesSidebarComponent } from '../notes-sidebar/notes-sidebar.component';

/**
 * "Container" component: the layout (sidebar | open note) and the initial loading.
 *
 * It opens the local database of the signed-in user and starts the synchronization with the server; the stores
 * then read that database, so the page shows at once, with or without a connection.
 *
 * The tag filter and the search text live in the URL: /notes?tag=<id>&q=<text>. Angular copies query parameters
 * into inputs with the same name (withComponentInputBinding), so reloading the page or sharing the link
 * keeps them, and the Back button steps through them.
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
  readonly q = input<string>(); // ?q=... (the search text)

  // True once the local database is open: only then may the pages inside (editor, trash...) be created.
  protected readonly ready = signal(false);

  private readonly auth = inject(AuthStore);
  private readonly session = inject(LocalSession);
  private readonly engine = inject(SyncEngine);
  private readonly store = inject(NotesStore);
  private readonly org = inject(OrganizationStore);
  private readonly trash = inject(TrashStore);
  private readonly message = inject(NzMessageService);

  constructor() {
    // Things the synchronization wants the user to know (a conflict, a note deleted elsewhere...).
    effect(() => {
      const notices = this.engine.notices();
      if (notices.length === 0) {
        return;
      }
      untracked(() => {
        for (const notice of notices) {
          if (notice.kind === 'rejected') this.message.error(notice.message, { nzDuration: 6000 });
          else this.message.warning(notice.message, { nzDuration: 8000 });
        }
        this.engine.clearNotices();
      });
    });

    // The trash lives on the server: when changes (such as a deletion) reached it, the trash has changed too.
    effect(() => {
      if (this.engine.pushedCount() > 0) {
        untracked(() => void this.trash.load());
      }
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const user = this.auth.user();
    if (!user) {
      return;
    }

    try {
      await this.session.begin(user.id);
    } catch {
      this.message.error('Cannot open the database of this browser (is private browsing on?). Notes cannot be shown.');
      return;
    }
    this.ready.set(true); // the open note (if the URL names one) can now be read

    // Both start now and run in parallel. They only read the local database: they answer at once.
    const [notesOk, orgOk] = await Promise.all([this.store.loadNotes(), this.org.load()]);
    if (!notesOk || !orgOk) {
      this.message.error('Cannot read the notes stored on this device.');
    }
    // The trash is the one thing that still comes from the server (only for the count next to "Trash").
    void this.trash.load();
  }
}
