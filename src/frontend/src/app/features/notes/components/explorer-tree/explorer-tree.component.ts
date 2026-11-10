import {
  ChangeDetectionStrategy,
  Component,
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

/**
 * "Presentational" component: draws the rows of the sidebar tree (folders and notes) and tells
 * its parent what the user asked for. It does not talk to the store or the API.
 *
 * Actions: small buttons on the row (on hover, on keyboard focus, and always on the open note and
 * the current folder) and the same actions in a menu (right-click, or the "..." button).
 * A note row also shows its status and tags, so they can be seen without opening the note.
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

  private readonly contextMenu = inject(NzContextMenuService);

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
