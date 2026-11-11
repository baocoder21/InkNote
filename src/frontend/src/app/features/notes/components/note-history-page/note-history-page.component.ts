import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { firstValueFrom } from 'rxjs';
import { SyncEngine } from '../../../sync/sync-engine.service';
import { NotesRepository } from '../../data/notes-repository';
import { NoteRevision, NoteRevisionSummary, revisionReasonLabel } from '../../models/revision.model';
import { NotesApi } from '../../services/notes-api.service';
import { NotesStore } from '../../store/notes.store';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';

/**
 * The history of one note (route /notes/:id/history): the older texts the server kept, newest first, with a read-only
 * preview of the one selected and a button to put it back.
 *
 * The history lives on the server only (like the search and the trash), so this page needs a connection. Putting a
 * version back is also done by the server, which first saves the text it replaces: a restore can be undone.
 */
@Component({
  selector: 'app-note-history-page',
  imports: [DatePipe, RouterLink, NzButtonComponent, NzIconDirective, NzSpinComponent, MarkdownPreviewComponent],
  templateUrl: './note-history-page.component.html',
  styleUrl: './note-history-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteHistoryPageComponent {
  readonly id = input.required<string>(); // the :id of the URL

  private readonly api = inject(NotesApi);
  private readonly engine = inject(SyncEngine);
  private readonly notes = inject(NotesRepository);
  private readonly store = inject(NotesStore);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);

  protected readonly items = signal<NoteRevisionSummary[]>([]);
  protected readonly loading = signal(true);
  /** Why the list is not shown: no connection, or the server said no (the note is gone, or another problem). */
  protected readonly problem = signal<'offline' | 'missing' | 'error' | null>(null);
  protected readonly selected = signal<NoteRevision | null>(null);
  protected readonly loadingSelected = signal(false);
  protected readonly restoring = signal(false);

  protected readonly label = revisionReasonLabel;

  /** The note's current title, for the heading. It is read from this device (the page is opened from the editor). */
  protected readonly noteTitle = () => this.store.selected()?.title ?? '';

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (this.store.selected()?.id !== id) {
          void this.store.loadNote(id); // a page opened directly by its address
        }
        void this.load(id);
      });
    });
  }

  protected async load(id = this.id()): Promise<void> {
    this.loading.set(true);
    this.problem.set(null);
    this.selected.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.revisions(id)));
    } catch (error) {
      this.items.set([]);
      this.problem.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : error instanceof HttpErrorResponse && error.status === 0 ? 'offline' : 'error');
    } finally {
      this.loading.set(false);
    }
  }

  protected async open(item: NoteRevisionSummary): Promise<void> {
    if (this.selected()?.id === item.id) {
      return;
    }
    this.loadingSelected.set(true);
    try {
      const revision = await firstValueFrom(this.api.revision(this.id(), item.id));
      this.selected.set(revision);
    } catch {
      this.selected.set(null);
      this.message.error('Cannot load this version. Check the connection and try again.');
    } finally {
      this.loadingSelected.set(false);
    }
  }

  protected confirmRestore(): void {
    const revision = this.selected();
    if (!revision) {
      return;
    }
    this.modal.confirm({
      nzTitle: 'Restore this version?',
      nzContent: 'The text the note has now is saved in the history first, so you can come back to it.',
      nzOkText: 'Restore',
      nzCancelText: 'Cancel',
      nzOnOk: () => this.restore(revision),
    });
  }

  private async restore(revision: NoteRevision): Promise<void> {
    const id = this.id();
    this.restoring.set(true);
    try {
      // The text typed on this device must be on the server first. Otherwise it would arrive AFTER the restore, look
      // like a conflict, and win over the version that was just put back.
      await this.engine.syncNow();
      if (await this.notes.hasUnsyncedChanges(id)) {
        this.message.warning('Your latest changes to this note have not been sent yet. Try again when the status says "All changes synced".');
        return;
      }

      await firstValueFrom(this.api.restoreRevision(id, revision.id));
      await this.engine.syncNow(); // brings the restored text to this device
      this.message.success('Version restored');
      await this.router.navigate(['/notes', id], { queryParamsHandling: 'preserve' });
    } catch (error) {
      this.message.error(this.restoreProblem(error));
      if (error instanceof HttpErrorResponse && error.status === 409) {
        await this.load(id); // the note changed meanwhile: look again
      }
    } finally {
      this.restoring.set(false);
    }
  }

  private restoreProblem(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Restoring needs a connection. Try again when you are online.';
      if (error.status === 404) return 'This note or this version no longer exists (a note in the trash must be restored from the trash first).';
      if (error.status === 409) return 'The note was changed while you were looking. Look at the history again.';
    }
    return 'Cannot restore this version.';
  }
}
