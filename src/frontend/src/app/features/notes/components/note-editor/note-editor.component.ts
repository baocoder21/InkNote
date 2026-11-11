import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzAlertComponent } from 'ng-zorro-antd/alert';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSegmentedComponent } from 'ng-zorro-antd/segmented';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { debounceTime, exhaustMap, filter, from } from 'rxjs';
import { AttachmentRepository } from '../../../attachments/data/attachment-repository';
import { markdownFor } from '../../../attachments/models/attachment.model';
import { NOTE_LIMITS, NoteOrganization } from '../../models/note.model';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';
import { NoteOrganizationComponent } from '../note-organization/note-organization.component';
import { SplitDividerComponent } from '../split-divider/split-divider.component';
import { loadSplitRatio, saveSplitRatio } from '../split-divider/split-ratio';

/**
 * Save to the database of this device this long (ms) after the user stops typing. A local save costs a few
 * milliseconds, so this is short (the pause before the SERVER is told is the sync engine's own).
 * An InjectionToken (instead of a plain constant) so that tests can shorten it.
 */
export const AUTOSAVE_DELAY_MS = new InjectionToken<number>('AUTOSAVE_DELAY_MS', {
  providedIn: 'root',
  factory: () => 400,
});

type ViewMode = 'edit' | 'split' | 'preview';

@Component({
  selector: 'app-note-editor',
  imports: [
    FormsModule,
    RouterLink,
    NzAlertComponent,
    NzIconDirective,
    NzSegmentedComponent,
    NzSpinComponent,
    MarkdownEditorComponent,
    MarkdownPreviewComponent,
    NoteOrganizationComponent,
    SplitDividerComponent,
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
  // Only READ here (notebook and tag choices); the notes page is the one that loads it.
  protected readonly org = inject(OrganizationStore);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly autosaveDelay = inject(AUTOSAVE_DELAY_MS);
  private readonly attachments = inject(AttachmentRepository);

  // The last SAVED text of the open note. `equal` makes this computed return "no change" when
  // only the organization changed (pin, notebook, tags, version): those updates replace
  // store.selected() but must not touch what the user is typing. A content save always changes
  // updatedAt, so it still counts as a change (this matters when the server trims the title:
  // the text is the same as before, but the box must be reset to the trimmed value).
  private readonly savedText = computed(
    () => {
      const note = this.store.selected();
      return note
        ? { id: note.id, title: note.title, content: note.content, updatedAt: note.updatedAt }
        : null;
    },
    {
      equal: (a, b) =>
        a?.id === b?.id &&
        a?.title === b?.title &&
        a?.content === b?.content &&
        a?.updatedAt === b?.updatedAt,
    },
  );

  // The text being typed. linkedSignal = a writable signal that follows the saved text: a new note
  // opened, or a change that arrives from elsewhere (the synchronization brought another device's edit).
  // But NEVER at the expense of the user: when the box holds something that is not saved yet (it differs
  // from the saved text it was last in step with) it keeps it. Otherwise a change arriving while somebody
  // types would swallow the last keystrokes.
  protected readonly title = linkedSignal<ReturnType<typeof this.savedText>, string>({
    source: this.savedText,
    computation: (saved, previous) =>
      previous && saved && previous.source?.id === saved.id && previous.value !== previous.source.title
        ? previous.value
        : (saved?.title ?? ''),
  });
  protected readonly content = linkedSignal<ReturnType<typeof this.savedText>, string>({
    source: this.savedText,
    computation: (saved, previous) =>
      previous && saved && previous.source?.id === saved.id && previous.value !== previous.source.content
        ? previous.value
        : (saved?.content ?? ''),
  });

  protected readonly viewMode = signal<ViewMode>('split');
  /** The width of the editor in Split mode, as a share of the whole (0.5 = half). The user's choice is remembered in the browser. */
  protected readonly splitRatio = signal(loadSplitRatio());

  protected rememberSplit(ratio: number): void {
    saveSplitRatio(ratio);
  }
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

  // There is no Save button: notes save by themselves (autosave) and with Ctrl+S.
  // This says whether a save would be accepted right now.
  protected readonly canSave = computed(
    () =>
      this.isDirty() &&
      this.title().trim().length > 0 &&
      !this.tooLong() &&
      !this.store.saving(),
  );

  // The title box (it only exists while a note is shown).
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly markdownEditor = viewChild(MarkdownEditorComponent);

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

    // "Rename" in the sidebar: when the title box of the requested note is on screen, focus it and
    // select its text, so typing replaces the name. The request names a note id so that a click on
    // another note (still loading) cannot steal the focus.
    effect(() => {
      const target = this.store.titleFocusFor();
      const box = this.titleInput();
      if (target === null || !box || target !== this.id() || this.store.selected()?.id !== target) {
        return;
      }
      untracked(() => this.store.clearTitleFocus());
      // One tick later: ngModel writes the text into the box asynchronously, and select() needs it.
      setTimeout(() => {
        box.nativeElement.focus();
        box.nativeElement.select();
      });
    });

    // The open note was deleted on another device (a synchronization brought that here).
    effect(() => {
      if (this.store.selectedGone()) {
        untracked(() => {
          this.message.warning('This note was deleted on another device.');
          void this.leave();
        });
      }
    });

    // AUTOSAVE (RxJS): every edit restarts the timer; when the user pauses for
    // `autosaveDelay` ms, save. exhaustMap ignores new triggers while a save is running.
    toObservable(this.pendingEdit)
      .pipe(
        debounceTime(this.autosaveDelay),
        filter((edit) => edit !== null && this.canSave()),
        exhaustMap(() => from(this.persist(true))),
        takeUntilDestroyed(),
      )
      .subscribe();

    // Leaving the page (e.g. to the empty state) with an unsaved draft: save it first.
    inject(DestroyRef).onDestroy(() => {
      const current = this.store.selected();
      if (current && this.canSave()) {
        void this.store.saveNote(current.id, this.title().trim(), this.content());
      }
    });
  }

  private async load(id: string, force: boolean): Promise<void> {
    // Switching notes: the draft of the note we are leaving must not be lost.
    await this.saveDraftBeforeSwitching(id);

    // Same note is already open (e.g. a forced reload is not requested): nothing to download.
    if (!force && this.store.selected()?.id === id) {
      return;
    }

    const result = await this.store.loadNote(id);
    if (result === 'not-found') {
      this.message.warning('Note not found');
      await this.leave();
    } else if (result === 'error') {
      this.message.error('Cannot load the note');
    }
  }

  private async saveDraftBeforeSwitching(nextId: string): Promise<void> {
    const current = this.store.selected();
    if (!current || current.id === nextId || !this.canSave()) {
      return;
    }
    const result = await this.store.saveNote(current.id, this.title().trim(), this.content());
    if (result !== 'ok') {
      this.message.warning(`Your last changes to "${current.title}" could not be saved.`);
    }
  }

  /**
   * Files pasted or dropped into the editor. Each one is stored on THIS device and queued for upload (so it shows at
   * once, offline too), and the Markdown that refers to it is written where the cursor is.
   */
  protected async addFiles(files: File[]): Promise<void> {
    const noteId = this.id();
    const snippets: string[] = [];
    for (const file of files) {
      const result = await this.attachments.add(noteId, file);
      if (result.status === 'ok') {
        snippets.push(markdownFor(result.id, result.name, result.isImage));
      } else {
        this.message.error(`"${file.name}": ${result.reason}`);
      }
    }
    // Another note may have been opened while the files were being stored: its editor must not get this Markdown.
    if (snippets.length > 0 && this.id() === noteId) {
      this.markdownEditor()?.insertText(snippets.join('\n') + '\n');
    }
  }

  /** Enter in the title saves now (like Ctrl+S) instead of waiting for the autosave delay. */
  protected onTitleEnter(event: Event): void {
    event.preventDefault();
    void this.save();
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

  /** Manual save (Ctrl+S): shows a "Saved" message. */
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
        if (!silent) {
          this.message.success('Saved', { nzDuration: 1500 });
        }
        break;
      case 'not-found':
        this.message.warning('This note no longer exists');
        await this.leave();
        break;
      default:
        this.message.error('Cannot save the note');
    }
  }

  /** The user changed the notebook, the pin or the tags (not the text). */
  protected async changeOrganization(change: NoteOrganization): Promise<void> {
    const result = await this.store.updateOrganization(this.id(), change);
    switch (result) {
      case 'ok':
        break;
      case 'not-found':
        this.message.warning('This note no longer exists');
        await this.leave();
        break;
      default:
        this.message.error('Cannot update the note');
    }
  }

  /** Back to the empty pane, keeping the current notebook/tag filter in the URL. */
  private leave(): Promise<boolean> {
    return this.router.navigate(['/notes'], { queryParamsHandling: 'preserve' });
  }

}
