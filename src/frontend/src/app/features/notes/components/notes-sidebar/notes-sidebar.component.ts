import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzContextMenuService, NzDropdownDirective, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMenuDirective, NzMenuItemComponent } from 'ng-zorro-antd/menu';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { firstValueFrom } from 'rxjs';
import { THEME_OPTIONS, ThemeService } from '../../../../core/theme.service';
import { NoteSummary } from '../../models/note.model';
import { Notebook, ORGANIZATION_LIMITS, Tag } from '../../models/organization.model';
import { buildExplorerRows, buildTagRows } from '../../organization/explorer-rows';
import { ancestorIds } from '../../organization/notebook-tree';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { ExplorerTreeComponent } from '../explorer-tree/explorer-tree.component';
import { NameDialogComponent, NameDialogData } from '../name-dialog/name-dialog.component';

const EXPANDED_KEY = 'inknote.expandedFolders';

/**
 * "Container" component: the one sidebar. A toolbar to create notes and folders, the tree of
 * folders and notes, and the tags. It talks to the stores, asks the user for names and
 * confirmations and reports problems; drawing the rows is delegated to ExplorerTreeComponent.
 */
@Component({
  selector: 'app-notes-sidebar',
  imports: [
    RouterLink,
    NzIconDirective,
    NzSpinComponent,
    NzDropdownDirective,
    NzDropdownMenuComponent,
    NzMenuDirective,
    NzMenuItemComponent,
    ExplorerTreeComponent,
  ],
  templateUrl: './notes-sidebar.component.html',
  styleUrl: './notes-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesSidebarComponent {
  // The tag filter (?tag=... in the URL), passed down by the page.
  readonly tagId = input<string | null>(null);

  protected readonly store = inject(NotesStore);
  protected readonly org = inject(OrganizationStore);
  protected readonly theme = inject(ThemeService);
  protected readonly themes = THEME_OPTIONS;
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  private readonly contextMenu = inject(NzContextMenuService);

  /** Folders that are open in the tree. Remembered between visits (see persistExpanded). */
  private readonly expanded = signal<ReadonlySet<string>>(this.loadExpanded());

  /** The folder "new note" and "new folder" use: the last one clicked, or the open note's folder. */
  protected readonly currentFolderId = signal<string | null>(null);
  protected readonly currentFolder = computed(
    () => this.org.notebooks().find((n) => n.id === this.currentFolderId()) ?? null,
  );

  protected readonly activeTag = computed(() => this.org.tags().find((t) => t.id === this.tagId()) ?? null);

  // With a tag filter the tree is replaced by the plain list of notes that have the tag.
  protected readonly rows = computed(() => {
    const tagId = this.tagId();
    return tagId
      ? buildTagRows(this.store.notes(), tagId)
      : buildExplorerRows(this.org.tree(), this.store.notes(), this.expanded());
  });

  // Which note is open and in which folder. `equal` keeps the effect below from re-running
  // when only the note's text changed (every autosave replaces store.selected()).
  private readonly openNoteFolder = computed(
    () => {
      const note = this.store.selected();
      return note ? { id: note.id, notebookId: note.notebookId } : null;
    },
    { equal: (a, b) => a?.id === b?.id && a?.notebookId === b?.notebookId },
  );
  private readonly hasNotebooks = computed(() => this.org.notebooks().length > 0);

  // The target of the tag menu (same idea as the tree's shared menu).
  protected readonly menuTag = signal<Tag | null>(null);

  constructor() {
    // When a note is opened (or moved to another folder): that folder becomes the current one
    // and the tree opens up to it, so the open note is always visible.
    effect(() => {
      const open = this.openNoteFolder();
      const ready = this.hasNotebooks(); // the folders may arrive after the note
      if (!open) {
        return;
      }
      untracked(() => {
        this.currentFolderId.set(open.notebookId);
        if (open.notebookId && ready) {
          this.reveal(open.notebookId);
        }
      });
    });
  }

  // ---- notes ----

  protected async newNote(): Promise<void> {
    const note = await this.store.createNote(this.currentFolderId());
    if (!note) {
      this.message.error('Cannot create the note');
      return;
    }
    if (note.notebookId) {
      this.reveal(note.notebookId);
    }
    // No query params: this also leaves a tag filter, where the new note (no tags) would be hidden.
    await this.router.navigate(['/notes', note.id]);
  }

  protected async newNoteIn(folder: Notebook): Promise<void> {
    this.currentFolderId.set(folder.id);
    await this.newNote();
  }

  protected async togglePin(note: NoteSummary): Promise<void> {
    const result = await this.store.updateOrganization(note.id, {
      notebookId: note.notebookId,
      isPinned: !note.isPinned,
      status: note.status,
      tagIds: note.tagIds,
    });
    if (result === 'conflict') {
      this.message.warning('This note was changed somewhere else. Reload the page and try again.');
    } else if (result !== 'ok') {
      this.message.error('Cannot pin the note');
    }
  }

  protected confirmDeleteNote(note: NoteSummary): void {
    this.modal.confirm({
      nzTitle: 'Delete note',
      nzContent: `Delete "${note.title}"? It will disappear from your notes.`,
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.deleteNote(note),
    });
  }

  private async deleteNote(note: NoteSummary): Promise<void> {
    const wasOpen = this.store.selected()?.id === note.id; // the store forgets it once deleted
    if (!(await this.store.deleteNote(note.id))) {
      this.message.error('Cannot delete the note');
      return;
    }
    this.message.success('Note deleted', { nzDuration: 1500 });
    if (wasOpen) {
      await this.router.navigate(['/notes'], { queryParamsHandling: 'preserve' });
    }
  }

  // ---- folders (notebooks) ----

  protected onFolderClick(folder: Notebook): void {
    this.currentFolderId.set(folder.id);
    const next = new Set(this.expanded());
    if (!next.delete(folder.id)) {
      next.add(folder.id);
    }
    this.setExpanded(next);
  }

  /** @param parent where to create the folder; undefined = inside the current folder. */
  protected async newFolder(parent?: Notebook | null): Promise<void> {
    const target = parent === undefined ? this.currentFolder() : parent;
    const name = await this.askName({
      title: target ? `New folder in "${target.name}"` : 'New folder',
      initialName: '',
      maxLength: ORGANIZATION_LIMITS.notebookNameMaxLength,
    });
    if (!name) {
      return;
    }
    const created = await this.org.createNotebook(name, target?.id ?? null);
    if (!created) {
      this.message.error('Cannot create the folder');
      return;
    }
    if (target) {
      this.reveal(target.id); // open the parent so the new folder is visible
    }
    this.currentFolderId.set(created.id);
  }

  protected async renameFolder(folder: Notebook): Promise<void> {
    const name = await this.askName({
      title: 'Rename folder',
      initialName: folder.name,
      maxLength: ORGANIZATION_LIMITS.notebookNameMaxLength,
    });
    if (!name || name === folder.name) {
      return;
    }
    const result = await this.org.renameNotebook(folder.id, name);
    if (result !== 'ok') {
      this.message.error(result === 'not-found' ? 'This folder no longer exists' : 'Cannot rename the folder');
    }
  }

  protected confirmDeleteFolder(folder: Notebook): void {
    this.modal.confirm({
      nzTitle: 'Delete folder',
      nzContent: `Delete the folder "${folder.name}"? It must be empty (no notes, no sub-folders).`,
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.deleteFolder(folder),
    });
  }

  private async deleteFolder(folder: Notebook): Promise<void> {
    const result = await this.org.deleteNotebook(folder.id);
    if (result === 'ok') {
      this.message.success('Folder deleted', { nzDuration: 1500 });
      if (this.currentFolderId() === folder.id) {
        this.currentFolderId.set(null);
      }
    } else if (result === 'not-empty') {
      this.message.warning(`"${folder.name}" still contains notes or sub-folders. Move or delete them first.`);
    } else {
      this.message.error('Cannot delete the folder');
    }
  }

  // ---- tags ----

  protected async addTag(): Promise<void> {
    const name = await this.askName({
      title: 'New tag',
      initialName: '',
      maxLength: ORGANIZATION_LIMITS.tagNameMaxLength,
    });
    if (!name) {
      return;
    }
    const result = await this.org.createTag(name);
    if (result.status === 'duplicate') {
      this.message.warning('A tag with this name already exists');
    } else if (result.status === 'error') {
      this.message.error('Cannot create the tag');
    }
  }

  protected openTagMenu(event: MouseEvent, tag: Tag, menu: NzDropdownMenuComponent): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuTag.set(tag);
    this.contextMenu.create(event, menu);
  }

  protected confirmDeleteTag(tag: Tag): void {
    this.contextMenu.close();
    this.modal.confirm({
      nzTitle: 'Delete tag',
      nzContent: `Delete the tag "${tag.name}"? It will be removed from every note (the notes stay).`,
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.deleteTag(tag),
    });
  }

  private async deleteTag(tag: Tag): Promise<void> {
    if (!(await this.org.deleteTag(tag.id))) {
      this.message.error('Cannot delete the tag');
      return;
    }
    this.message.success('Tag deleted', { nzDuration: 1500 });
    this.store.forgetTag(tag.id); // the server removed it from every note: mirror that here
    if (this.tagId() === tag.id) {
      await this.router.navigate(['/notes']);
    }
  }

  // ---- open / closed folders ----

  /** Opens the folder and all its ancestors. */
  private reveal(folderId: string): void {
    const next = new Set(this.expanded());
    next.add(folderId);
    ancestorIds(folderId, this.org.notebooks()).forEach((id) => next.add(id));
    this.setExpanded(next);
  }

  private setExpanded(next: ReadonlySet<string>): void {
    this.expanded.set(next);
    // Remembered in the browser so the tree looks the same after a reload. Wrapped in try/catch:
    // storage can be blocked (private window) and the app must work without it.
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* not remembered, nothing else to do */
    }
  }

  private loadExpanded(): ReadonlySet<string> {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');
      return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  // ---- shared ----

  /** Opens the name dialog; resolves with the trimmed name, or null when the user cancels. */
  private async askName(data: NameDialogData): Promise<string | null> {
    const ref = this.modal.create<NameDialogComponent, NameDialogData, string>({
      nzTitle: data.title,
      nzContent: NameDialogComponent,
      nzData: data,
      nzFooter: null, // the dialog has its own Save / Cancel buttons
      nzWidth: 380,
    });
    return (await firstValueFrom(ref.afterClose)) ?? null;
  }
}
