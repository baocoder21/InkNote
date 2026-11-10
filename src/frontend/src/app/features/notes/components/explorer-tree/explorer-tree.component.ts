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
import { NoteSummary } from '../../models/note.model';
import { Notebook } from '../../models/organization.model';
import { ExplorerRow } from '../../organization/explorer-rows';

/**
 * "Presentational" component: draws the rows of the sidebar tree (folders and notes) and tells
 * its parent what the user asked for. It does not talk to the store or the API.
 *
 * Actions live in a menu: right-click a row, or use the "..." button that appears on hover.
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

  readonly folderClick = output<Notebook>(); // expand / collapse (and make it the current folder)
  readonly newNoteIn = output<Notebook>();
  readonly newFolderIn = output<Notebook>();
  readonly renameFolder = output<Notebook>();
  readonly deleteFolder = output<Notebook>();
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
