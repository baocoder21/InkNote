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
import { Router } from '@angular/router';
import { NzAlertComponent } from 'ng-zorro-antd/alert';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSegmentedComponent } from 'ng-zorro-antd/segmented';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { debounceTime, exhaustMap, filter, from } from 'rxjs';
import { NOTE_LIMITS, NoteOrganization } from '../../models/note.model';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';
import { NoteOrganizationComponent } from '../note-organization/note-organization.component';

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
    NzAlertComponent,
    NzButtonComponent,
    NzSegmentedComponent,
    NzSpinComponent,
    MarkdownEditorComponent,
    MarkdownPreviewComponent,
    NoteOrganizationComponent,
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

  // The text being typed. linkedSignal = a writable signal that is reset to the saved
  // text whenever savedText() changes (new note opened, or saved successfully).
  protected readonly title = linkedSignal(() => this.savedText()?.title ?? '');
  protected readonly content = linkedSignal(() => this.savedText()?.content ?? '');

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

  // There is no Save button: notes save by themselves (autosave) and with Ctrl+S.
  // This says whether a save would be accepted right now.
  protected readonly canSave = computed(
    () =>
      this.isDirty() &&
      this.title().trim().length > 0 &&
      !this.tooLong() &&
      !this.store.saving(),
  );

  // True after the server answered 409: someone else changed this note.
  protected readonly conflict = signal(false);

  // The title box (it only exists while a note is shown).
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

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
      await this.leave();
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
      case 'conflict':
        this.conflict.set(true); // same banner as a content conflict: reload to get the latest
        break;
      case 'not-found':
        this.message.warning('This note no longer exists');
        await this.leave();
        break;
      case 'invalid':
        // A notebook or tag was deleted elsewhere: refresh the choices so the pickers are right.
        this.message.warning('The notebook or a tag no longer exists. The lists were refreshed.');
        void this.org.load();
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
