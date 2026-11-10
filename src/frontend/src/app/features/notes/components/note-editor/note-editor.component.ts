import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzAlertComponent } from 'ng-zorro-antd/alert';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzInputDirective } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSegmentedComponent } from 'ng-zorro-antd/segmented';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { debounceTime, exhaustMap, filter, from } from 'rxjs';
import { NOTE_LIMITS } from '../../models/note.model';
import { NotesStore } from '../../store/notes.store';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';

/**
 * Save automatically this long (ms) after the user stops typing.
 * An InjectionToken (instead of a plain constant) so that tests can shorten it.
 */
export const AUTOSAVE_DELAY_MS = new InjectionToken<number>('AUTOSAVE_DELAY_MS', {
  providedIn: 'root',
  factory: () => 1500,
});

type ViewMode = 'edit' | 'split' | 'preview';

@Component({
  selector: 'app-note-editor',
  imports: [
    FormsModule,
    DatePipe,
    NzAlertComponent,
    NzButtonComponent,
    NzIconDirective,
    NzInputDirective,
    NzSegmentedComponent,
    NzSpinComponent,
    MarkdownEditorComponent,
    MarkdownPreviewComponent,
  ],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Ctrl+S anywhere inside the editor saves the note.
    '(keydown.control.s)': 'onSaveShortcut($event)',
    // Closing the tab with unsaved changes makes the browser ask for confirmation.
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class NoteEditorComponent {
  // Filled from the :id segment of the URL (thanks to withComponentInputBinding).
  readonly id = input.required<string>();

  protected readonly store = inject(NotesStore);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly modal = inject(NzModalService);
  private readonly autosaveDelay = inject(AUTOSAVE_DELAY_MS);

  // The text being typed. linkedSignal = a writable signal that is reset to the server's
  // value whenever store.selected() changes (new note opened, or saved successfully).
  protected readonly title = linkedSignal(() => this.store.selected()?.title ?? '');
  protected readonly content = linkedSignal(() => this.store.selected()?.content ?? '');

  protected readonly viewMode = signal<ViewMode>('split');
  protected readonly viewOptions = [
    { label: 'Edit', value: 'edit' },
    { label: 'Split', value: 'split' },
    { label: 'Preview', value: 'preview' },
  ];

  protected readonly isDirty = computed(() => {
    const note = this.store.selected();
    return !!note && (this.title() !== note.title || this.content() !== note.content);
  });

  protected readonly tooLong = computed(() => this.content().length > NOTE_LIMITS.contentMaxLength);

  protected readonly canSave = computed(
    () =>
      this.isDirty() &&
      this.title().trim().length > 0 &&
      !this.tooLong() &&
      !this.store.saving(),
  );

  // True after the server answered 409: someone else changed this note.
  protected readonly conflict = signal(false);

  // Changes on every edit while there is something to save; null when there is nothing.
  private readonly pendingEdit = computed(() =>
    this.isDirty() ? { title: this.title(), content: this.content() } : null,
  );

  constructor() {
    // Re-runs whenever the id changes (user clicks another note in the list).
    // untracked: only `id` should trigger the effect, not the signals read inside load().
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id, false));
    });

    // AUTOSAVE (RxJS): every edit restarts the timer; when the user pauses for
    // `autosaveDelay` ms, save. exhaustMap ignores new triggers while a save is running.
    toObservable(this.pendingEdit)
      .pipe(
        debounceTime(this.autosaveDelay),
        filter((edit) => edit !== null && this.canSave() && !this.conflict()),
        exhaustMap(() => from(this.persist(true))),
        takeUntilDestroyed(),
      )
      .subscribe();

    // Leaving the page (e.g. to the empty state) with an unsaved draft: save it first.
    inject(DestroyRef).onDestroy(() => {
      const current = this.store.selected();
      if (current && this.canSave() && !this.conflict()) {
        void this.store.saveNote(current.id, this.title().trim(), this.content());
      }
    });
  }

  private async load(id: string, force: boolean): Promise<void> {
    // Switching notes: the draft of the note we are leaving must not be lost.
    await this.saveDraftBeforeSwitching(id);
    this.conflict.set(false);

    // Same note is already open (e.g. a forced reload is not requested): nothing to download.
    if (!force && this.store.selected()?.id === id) {
      return;
    }

    const result = await this.store.loadNote(id);
    if (result === 'not-found') {
      this.message.warning('Note not found');
      await this.router.navigate(['/notes']);
    } else if (result === 'error') {
      this.message.error('Cannot load the note');
    }
  }

  private async saveDraftBeforeSwitching(nextId: string): Promise<void> {
    const current = this.store.selected();
    if (!current || current.id === nextId || !this.canSave() || this.conflict()) {
      return;
    }
    const result = await this.store.saveNote(current.id, this.title().trim(), this.content());
    if (result !== 'ok') {
      this.message.warning(`Your last changes to "${current.title}" could not be saved.`);
    }
  }

  protected reload(): void {
    void this.load(this.id(), true);
  }

  protected onSaveShortcut(event: Event): void {
    event.preventDefault(); // stop the browser's own "Save page" dialog
    void this.save();
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isDirty()) {
      event.preventDefault();
    }
  }

  /** Manual save (button / Ctrl+S): shows a "Saved" message. */
  protected save(): Promise<void> {
    return this.persist(false);
  }

  /** @param silent autosave does not show the "Saved" message on success. */
  private async persist(silent: boolean): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    const result = await this.store.saveNote(this.id(), this.title().trim(), this.content());
    switch (result) {
      case 'ok':
        this.conflict.set(false);
        if (!silent) {
          this.message.success('Saved', { nzDuration: 1500 });
        }
        break;
      case 'conflict':
        this.conflict.set(true); // shows the banner; the user's text stays untouched
        break;
      case 'not-found':
        this.message.warning('This note no longer exists');
        await this.router.navigate(['/notes']);
        break;
      default:
        this.message.error('Cannot save the note');
    }
  }

  protected confirmDelete(): void {
    this.modal.confirm({
      nzTitle: 'Delete note',
      nzContent: 'Delete this note? It will disappear from your list.',
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      // Returning a Promise keeps the OK button in a loading state until it finishes.
      nzOnOk: () => this.delete(),
    });
  }

  private async delete(): Promise<void> {
    const ok = await this.store.deleteNote(this.id());
    if (ok) {
      this.message.success('Note deleted', { nzDuration: 1500 });
      await this.router.navigate(['/notes']);
    } else {
      this.message.error('Cannot delete the note');
    }
  }
}
