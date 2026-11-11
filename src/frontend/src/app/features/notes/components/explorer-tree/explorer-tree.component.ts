import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  OutputEmitterRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzContextMenuService, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMenuDirective, NzMenuDividerDirective, NzMenuItemComponent } from 'ng-zorro-antd/menu';
import { NOTE_STATUS_OPTIONS, NoteStatus, NoteSummary } from '../../models/note.model';
import { Notebook, Tag } from '../../models/organization.model';
import { ExplorerRow } from '../../organization/explorer-rows';

/** A note dragged onto a folder (or out of its folder, onto the top level: notebookId null). */
export interface NoteMove {
  noteId: string;
  notebookId: string | null;
}

/** The kind of data a dragged note carries: only this app's own drags are accepted, never a file or text from elsewhere. */
export const NOTE_DRAG_TYPE = 'application/x-inknote-note';

/** How long a dragged note must rest over a closed folder before the folder opens. A token so that tests can shorten it. */
export const DRAG_EXPAND_DELAY_MS = new InjectionToken<number>('DRAG_EXPAND_DELAY_MS', {
  providedIn: 'root',
  factory: () => 700,
});

/**
 * "Presentational" component: draws the rows of the sidebar tree (folders and notes) and tells
 * its parent what the user asked for. It does not talk to the store or the API.
 *
 * Actions: small buttons on the row (on hover, on keyboard focus, and always on the open note and
 * the current folder) and the same actions in a menu (right-click, or the "..." button).
 * A note row also shows its status and tags, so they can be seen without opening the note.
 *
 * Drag and drop: a note can be dragged onto a folder (it moves into it), onto a note (it moves to the folder of that
 * note), or onto the empty space of the tree (it moves out of its folder, to the top level). The component only
 * reports the move (`moveNote`); the parent saves it.
 */
@Component({
  selector: 'app-explorer-tree',
  imports: [
    RouterLink,
    RouterLinkActive,
    NzIconDirective,
    NzDropdownMenuComponent,
    NzMenuDirective,
    NzMenuItemComponent,
    NzMenuDividerDirective,
  ],
  templateUrl: './explorer-tree.component.html',
  styleUrl: './explorer-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The empty space of the tree (the host element fills the sidebar) is the "top level" drop area. Rows handle their own
  // drops and stop them from reaching these.
  host: {
    '[class.drop-root]': "dropOn() === 'root'",
    '(dragover)': 'offer($event, null)',
    '(dragleave)': 'leaveTree($event)',
    '(drop)': 'take($event, null)',
    '(click)': 'onBackgroundClick($event)',
  },
})
export class ExplorerTreeComponent {
  readonly rows = input.required<ExplorerRow[]>();
  // The folder that "new note" / "new folder" will use: drawn slightly highlighted.
  readonly currentFolderId = input<string | null>(null);
  // All tags: a note only stores tag ids, and its row shows the NAMES.
  readonly tags = input<Tag[]>([]);

  readonly folderClick = output<Notebook>(); // expand / collapse (and make it the current folder)
  readonly newNoteIn = output<Notebook>();
  readonly newFolderIn = output<Notebook>();
  readonly renameFolder = output<Notebook>();
  readonly deleteFolder = output<Notebook>();
  readonly renameNote = output<NoteSummary>();
  readonly togglePin = output<NoteSummary>();
  readonly deleteNote = output<NoteSummary>();
  readonly exportNote = output<NoteSummary>();
  readonly exportFolder = output<Notebook>();
  readonly importIntoFolder = output<Notebook>();
  readonly moveNote = output<NoteMove>();
  /** A click on the empty space of the tree (not on a row): "nothing selected", so the next new item goes to the top level. */
  readonly emptyClick = output<void>();

  private readonly contextMenu = inject(NzContextMenuService);
  private readonly expandDelay = inject(DRAG_EXPAND_DELAY_MS);

  // ---- drag and drop ----
  /** The note being dragged (null when nothing is). Not read from the drag data: that is hidden until the drop. */
  protected readonly dragged = signal<NoteSummary | null>(null);
  /** Where a drop would go right now: a folder id, 'root' for the top level, null for nowhere. Draws the highlight. */
  protected readonly dropOn = signal<string | null>(null);
  private readonly hasFolders = computed(() => this.rows().some((r) => r.kind === 'folder'));
  private expandTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelExpand());
  }

  // The row the open menu belongs to (the one menu template is shared by all rows).
  private readonly target = signal<ExplorerRow | null>(null);
  protected readonly targetFolder = computed(() => {
    const row = this.target();
    return row?.kind === 'folder' ? row.notebook : null;
  });
  protected readonly targetNote = computed(() => {
    const row = this.target();
    return row?.kind === 'note' ? row.note : null;
  });

  private readonly tagNames = computed(() => new Map(this.tags().map((t) => [t.id, t.name])));

  // Rows stay compact: at most this many tag chips, the rest becomes one "+N" chip.
  private static readonly MAX_TAG_CHIPS = 2;

  protected statusLabel(status: NoteStatus): string {
    return NOTE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  }

  /** Names of the tags of a note (ids of deleted tags are skipped), sorted so the order is stable. */
  private namesOf(note: NoteSummary): string[] {
    const names = this.tagNames();
    return note.tagIds.flatMap((id) => names.get(id) ?? []).sort((a, b) => a.localeCompare(b));
  }

  protected shownTags(note: NoteSummary): string[] {
    return this.namesOf(note).slice(0, ExplorerTreeComponent.MAX_TAG_CHIPS);
  }

  protected hiddenTagCount(note: NoteSummary): number {
    return Math.max(0, this.namesOf(note).length - ExplorerTreeComponent.MAX_TAG_CHIPS);
  }

  protected allTags(note: NoteSummary): string {
    return this.namesOf(note).join(', ');
  }

  protected onBackgroundClick(event: MouseEvent): void {
    if (!(event.target as Element).closest('.row')) {
      this.emptyClick.emit();
    }
  }

  // ---- dragging a note ----

  protected dragStart(event: DragEvent, note: NoteSummary): void {
    const data = event.dataTransfer;
    if (!data) {
      return;
    }
    data.setData(NOTE_DRAG_TYPE, note.id);
    data.setData('text/plain', note.title); // dropped into a text field, the note's title is what arrives
    data.effectAllowed = 'move';
    this.dragged.set(note);
  }

  protected dragEnd(): void {
    this.dragged.set(null);
    this.dropOn.set(null);
    this.cancelExpand();
  }

  /** Can the dragged note go to `target` (a folder id, null = top level)? Not where it already is. */
  private canDropOn(target: string | null): boolean {
    const note = this.dragged();
    if (!note || note.notebookId === target) {
      return false;
    }
    return target !== null || this.hasFolders(); // "top level" only means something when there are folders
  }

  /**
   * dragover: says "a drop is welcome here" (by cancelling the event: that is how the browser is told) and lights up the
   * folder. Rows call it with their own target and stop the event; the empty space of the tree calls it with null.
   */
  protected offer(event: DragEvent, target: string | null): void {
    if (!this.dragged()) {
      return; // not a note of ours (a file from the desktop, a piece of text): never a target
    }
    if (this.canDropOn(target)) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      this.dropOn.set(target ?? 'root');
    } else {
      this.dropOn.set(null);
    }
  }

  /** drop: reports the move. */
  protected take(event: DragEvent, target: string | null): void {
    const note = this.dragged();
    if (!note) {
      return;
    }
    event.preventDefault();
    const allowed = this.canDropOn(target);
    this.dragEnd();
    if (allowed) {
      this.moveNote.emit({ noteId: note.id, notebookId: target });
    }
  }

  protected folderOver(event: DragEvent, row: Extract<ExplorerRow, { kind: 'folder' }>): void {
    event.stopPropagation(); // this folder decides, not the "top level" area behind it
    this.offer(event, row.notebook.id);
    // Resting over a closed folder opens it, so a note can be dropped into a sub-folder in one gesture.
    if (this.dragged() && row.hasChildren && !row.expanded) {
      this.expandTimer ??= setTimeout(() => {
        this.expandTimer = null;
        if (this.dropOn() === row.notebook.id) {
          this.folderClick.emit(row.notebook);
        }
      }, this.expandDelay);
    } else {
      this.cancelExpand();
    }
  }

  protected folderDrop(event: DragEvent, folder: Notebook): void {
    event.stopPropagation();
    this.take(event, folder.id);
  }

  /** A note row stands for "the folder this note is in": dropping on it is like dropping between its neighbours. */
  protected noteOver(event: DragEvent, note: NoteSummary): void {
    event.stopPropagation();
    this.cancelExpand();
    this.offer(event, note.notebookId);
  }

  protected noteDrop(event: DragEvent, note: NoteSummary): void {
    event.stopPropagation();
    this.take(event, note.notebookId);
  }

  /** The pointer left the whole tree (not just one row for the next): nothing is lit any more. */
  protected leaveTree(event: DragEvent): void {
    const host = event.currentTarget as HTMLElement;
    if (!host.contains(event.relatedTarget as Node | null)) {
      this.dropOn.set(null);
      this.cancelExpand();
    }
  }

  private cancelExpand(): void {
    if (this.expandTimer !== null) {
      clearTimeout(this.expandTimer);
      this.expandTimer = null;
    }
  }

  /** A click on a quick-action button: it must not also open the note or expand the folder. */
  protected act<T>(event: Event, emitter: OutputEmitterRef<T>, value: T): void {
    event.preventDefault();
    event.stopPropagation();
    emitter.emit(value);
  }

  protected openMenu(event: MouseEvent, row: ExplorerRow, menu: NzDropdownMenuComponent): void {
    event.preventDefault(); // no browser menu
    event.stopPropagation(); // the click on "..." must not also expand the folder
    this.target.set(row);
    this.contextMenu.create(event, menu); // opens the menu where the pointer is
  }

  /** Closes the menu, then reports the chosen action. */
  protected run<T>(emitter: OutputEmitterRef<T>, value: T): void {
    this.contextMenu.close();
    emitter.emit(value);
  }
}
