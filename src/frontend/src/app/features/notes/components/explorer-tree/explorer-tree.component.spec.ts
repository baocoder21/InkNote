import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { NzModalService } from 'ng-zorro-antd/modal';
import { provideUi } from '../../../../core/ui.providers';
import { NoteSummary } from '../../models/note.model';
import { Notebook, Tag } from '../../models/organization.model';
import { buildExplorerRows } from '../../organization/explorer-rows';
import { buildNotebookTree } from '../../organization/notebook-tree';
import { ExplorerTreeComponent } from './explorer-tree.component';

const nb = (id: string, name: string, parentId: string | null = null): Notebook => ({ id, name, parentId });
const note = (id: string, title: string, notebookId: string | null, isPinned = false): NoteSummary => ({
  id,
  title,
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId,
  isPinned,
  status: 'None',
  tagIds: [],
});

const FOLDERS = buildNotebookTree([nb('w', 'Work'), nb('p', 'Projects', 'w')]);
const NOTES = [note('n1', 'Plan', 'w'), note('n2', 'Roadmap', 'p', true), note('n3', 'Loose', null)];

describe('ExplorerTreeComponent', () => {
  let fixture: ComponentFixture<ExplorerTreeComponent>;
  const root = () => fixture.nativeElement as HTMLElement;
  const rowNamed = (name: string) =>
    Array.from(root().querySelectorAll<HTMLElement>('.row')).find((r) => r.querySelector('.row__name')?.textContent === name)!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExplorerTreeComponent],
      providers: [provideRouter([]), provideUi(), NzContextMenuService],
    }).compileComponents();
    fixture = TestBed.createComponent(ExplorerTreeComponent);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = '')); // close open menus
  });

  function show(
    expanded: string[] = [],
    currentFolderId: string | null = null,
    notes: NoteSummary[] = NOTES,
    tags: Tag[] = [],
  ) {
    fixture.componentRef.setInput('rows', buildExplorerRows(FOLDERS, notes, new Set(expanded)));
    fixture.componentRef.setInput('tags', tags);
    fixture.componentRef.setInput('currentFolderId', currentFolderId);
    fixture.detectChanges();
  }

  /** Opens the menu of a row the way a user does: right-click. Returns the menu entries by text. */
  async function rightClick(name: string) {
    rowNamed(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Only real entries, not the divider lines between them.
    return () => Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li[nz-menu-item]'));
  }

  it('draws collapsed folders and loose notes, with notes linking to /notes/<id>', () => {
    show();

    const names = Array.from(root().querySelectorAll('.row__name')).map((e) => e.textContent);
    expect(names).toEqual(['Work', 'Loose']);
    expect(rowNamed('Loose').querySelector('a')!.getAttribute('href')).toBe('/notes/n3');
  });

  it('indents each level and draws a pin icon only for pinned notes', () => {
    show(['w', 'p']);

    const padding = (name: string) => rowNamed(name).style.paddingLeft;
    expect(padding('Work')).toBe('0.5rem');
    expect(padding('Projects')).toBe('1.5rem');
    expect(padding('Roadmap')).toBe('2.5rem');
    expect(rowNamed('Roadmap').querySelector('.row__pin')).not.toBeNull();
    expect(rowNamed('Plan').querySelector('.row__pin')).toBeNull();
  });

  it('highlights the current folder', () => {
    show([], 'w');

    expect(rowNamed('Work').classList).toContain('row--current');
  });

  it('reports a click on a folder', () => {
    show();
    const clicked: string[] = [];
    fixture.componentInstance.folderClick.subscribe((f) => clicked.push(f.id));

    rowNamed('Work').click();

    expect(clicked).toEqual(['w']);
  });

  it('a folder menu offers new note, new subfolder, rename and delete, and reports the choice', async () => {
    show();
    const events: string[] = [];
    const c = fixture.componentInstance;
    c.newNoteIn.subscribe((f) => events.push(`note:${f.id}`));
    c.newFolderIn.subscribe((f) => events.push(`folder:${f.id}`));
    c.renameFolder.subscribe((f) => events.push(`rename:${f.id}`));
    c.deleteFolder.subscribe((f) => events.push(`delete:${f.id}`));

    const items = await rightClick('Work');
    expect(items().map((i) => i.textContent!.trim())).toEqual(['New note here', 'New subfolder', 'Rename', 'Delete folder']);

    for (const label of ['New note here', 'New subfolder', 'Rename', 'Delete folder']) {
      (await rightClick('Work'))().find((i) => i.textContent!.includes(label))!.click();
    }

    expect(events).toEqual(['note:w', 'folder:w', 'rename:w', 'delete:w']);
  });

  it('a note menu offers pin / unpin and delete', async () => {
    show(['w', 'p']);
    const events: string[] = [];
    fixture.componentInstance.togglePin.subscribe((n) => events.push(`pin:${n.id}`));
    fixture.componentInstance.deleteNote.subscribe((n) => events.push(`delete:${n.id}`));

    const unpinned = await rightClick('Plan');
    expect(unpinned().map((i) => i.textContent!.trim())).toEqual(['Rename', 'Pin to top', 'Delete note']);
    unpinned().find((i) => i.textContent!.includes('Pin to top'))!.click();

    const pinned = await rightClick('Roadmap');
    expect(pinned().map((i) => i.textContent!.trim())).toEqual(['Rename', 'Unpin', 'Delete note']);
    pinned().find((i) => i.textContent!.includes('Delete note'))!.click();

    expect(events).toEqual(['pin:n1', 'delete:n2']);
  });

  it('a note menu also offers Rename, and reports it', async () => {
    show(['w', 'p']);
    const renamed: string[] = [];
    fixture.componentInstance.renameNote.subscribe((n) => renamed.push(n.id));

    (await rightClick('Plan'))().find((i) => i.textContent!.includes('Rename'))!.click();

    expect(renamed).toEqual(['n1']);
  });

  describe('quick action buttons on the rows', () => {
    const button = (name: string, title: string) =>
      rowNamed(name).querySelector<HTMLButtonElement>(`.row__btn[title="${title}"]`)!;

    it('a folder has new note, new subfolder and rename buttons; they do not expand it', () => {
      show();
      const events: string[] = [];
      const c = fixture.componentInstance;
      c.folderClick.subscribe((f) => events.push(`click:${f.id}`));
      c.newNoteIn.subscribe((f) => events.push(`note:${f.id}`));
      c.newFolderIn.subscribe((f) => events.push(`folder:${f.id}`));
      c.renameFolder.subscribe((f) => events.push(`rename:${f.id}`));

      button('Work', 'New note in this folder').click();
      button('Work', 'New subfolder').click();
      button('Work', 'Rename').click();

      expect(events).toEqual(['note:w', 'folder:w', 'rename:w']); // and no click:w
    });

    it('a note has a rename button; it does not navigate (the click stops there)', () => {
      show(['w']);
      const renamed: string[] = [];
      fixture.componentInstance.renameNote.subscribe((n) => renamed.push(n.id));
      const link = rowNamed('Plan').querySelector<HTMLAnchorElement>('a')!;
      let linkClicked = false;
      link.addEventListener('click', () => (linkClicked = true));

      button('Plan', 'Rename').click();

      expect(renamed).toEqual(['n1']);
      expect(linkClicked).toBe(false);
    });
  });

  describe('status and tags on a note row', () => {
    const TAGS: Tag[] = [
      { id: 't1', name: 'urgent' },
      { id: 't2', name: 'idea' },
      { id: 't3', name: 'later' },
    ];
    const meta = (name: string) => rowNamed(name).querySelector('.row__meta');
    const chips = (name: string, selector: string) =>
      Array.from(rowNamed(name).querySelectorAll(selector)).map((e) => e.textContent!.trim());

    it('shows no chip line for a note without status and tags', () => {
      show();

      expect(meta('Loose')).toBeNull();
    });

    it('shows the status label and the tag NAMES (sorted), without opening the note', () => {
      show([], null, [{ ...note('n3', 'Loose', null), status: 'OnHold', tagIds: ['t1', 't2'] }], TAGS);

      expect(chips('Loose', '.chip--status')).toEqual(['On hold']);
      expect(rowNamed('Loose').querySelector('.chip--status')!.getAttribute('data-status')).toBe('OnHold');
      expect(chips('Loose', '.chip--tag')).toEqual(['idea', 'urgent']);
    });

    it('shows at most two tags and a +N chip for the rest (with all names in its tooltip)', () => {
      show([], null, [{ ...note('n3', 'Loose', null), tagIds: ['t1', 't2', 't3'] }], TAGS);

      expect(chips('Loose', '.chip--tag')).toEqual(['idea', 'later']);
      const more = rowNamed('Loose').querySelector('.chip--more')!;
      expect(more.textContent!.trim()).toBe('+1');
      expect(more.getAttribute('title')).toBe('idea, later, urgent');
    });

    it('a status alone is enough to draw the line; ids of deleted tags are skipped', () => {
      show([], null, [{ ...note('n3', 'Loose', null), status: 'Active', tagIds: ['gone'] }], TAGS);

      expect(chips('Loose', '.chip--status')).toEqual(['Active']);
      expect(chips('Loose', '.chip--tag')).toEqual([]);
      expect(rowNamed('Loose').querySelector('.chip--more')).toBeNull();
    });
  });

  it('the "..." button opens the same menu and does not also expand the folder', async () => {
    show();
    const clicked: string[] = [];
    fixture.componentInstance.folderClick.subscribe((f) => clicked.push(f.id));

    rowNamed('Work').querySelector<HTMLButtonElement>('.row__btn[title="More actions"]')!.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.querySelector('.cdk-overlay-container')!.textContent).toContain('New note here');
    expect(clicked).toEqual([]);
  });
});
