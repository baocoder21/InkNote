import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { NzModalService } from 'ng-zorro-antd/modal';
import { provideUi } from '../../../../core/ui.providers';
import { NoteSummary } from '../../models/note.model';
import { Notebook, Tag } from '../../models/organization.model';
import { buildExplorerRows } from '../../organization/explorer-rows';
import { buildNotebookTree } from '../../organization/notebook-tree';
import { DRAG_EXPAND_DELAY_MS, ExplorerTreeComponent } from './explorer-tree.component';

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

  it('reports a click on the empty space of the tree, but not a click on a row or on its buttons', () => {
    show(['w']);
    let empty = 0;
    fixture.componentInstance.emptyClick.subscribe(() => empty++);

    rowNamed('Work').click();
    rowNamed('Plan').click(); // the row itself (its link would navigate, and this spec has no routes)
    rowNamed('Work').querySelector<HTMLButtonElement>('.row__btn')!.click();
    expect(empty).toBe(0);

    root().click(); // the free space under the last row (the host element fills the sidebar)
    expect(empty).toBe(1);
    root().querySelector<HTMLElement>('ul.tree')!.click();
    expect(empty).toBe(2);
  });

  it('a folder menu offers new note, new subfolder, import, export, rename and delete, and reports the choice', async () => {
    show();
    const events: string[] = [];
    const c = fixture.componentInstance;
    c.newNoteIn.subscribe((f) => events.push(`note:${f.id}`));
    c.newFolderIn.subscribe((f) => events.push(`folder:${f.id}`));
    c.importIntoFolder.subscribe((f) => events.push(`import:${f.id}`));
    c.exportFolder.subscribe((f) => events.push(`export:${f.id}`));
    c.renameFolder.subscribe((f) => events.push(`rename:${f.id}`));
    c.deleteFolder.subscribe((f) => events.push(`delete:${f.id}`));

    const labels = ['New note here', 'New subfolder', 'Import into this folder…', 'Export this folder', 'Rename', 'Delete folder'];
    const items = await rightClick('Work');
    expect(items().map((i) => i.textContent!.trim())).toEqual(labels);

    for (const label of labels) {
      (await rightClick('Work'))().find((i) => i.textContent!.includes(label))!.click();
    }

    expect(events).toEqual(['note:w', 'folder:w', 'import:w', 'export:w', 'rename:w', 'delete:w']);
  });

  it('a note menu offers rename, pin / unpin, export and delete', async () => {
    show(['w', 'p']);
    const events: string[] = [];
    fixture.componentInstance.togglePin.subscribe((n) => events.push(`pin:${n.id}`));
    fixture.componentInstance.deleteNote.subscribe((n) => events.push(`delete:${n.id}`));
    fixture.componentInstance.exportNote.subscribe((n) => events.push(`export:${n.id}`));

    const unpinned = await rightClick('Plan');
    expect(unpinned().map((i) => i.textContent!.trim())).toEqual(['Rename', 'Pin to top', 'Export', 'Delete note']);
    unpinned().find((i) => i.textContent!.includes('Pin to top'))!.click();

    const pinned = await rightClick('Roadmap');
    expect(pinned().map((i) => i.textContent!.trim())).toEqual(['Rename', 'Unpin', 'Export', 'Delete note']);
    pinned().find((i) => i.textContent!.includes('Export'))!.click();
    const again = await rightClick('Roadmap');
    again().find((i) => i.textContent!.includes('Delete note'))!.click();

    expect(events).toEqual(['pin:n1', 'export:n2', 'delete:n2']);
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

  describe('dragging a note', () => {
    // A stand-in for the browser's DataTransfer (jsdom has none): what the component writes and reads of it.
    let dataTransfer: { data: Record<string, string>; setData(type: string, value: string): void; effectAllowed: string; dropEffect: string };
    let moves: { noteId: string; notebookId: string | null }[];
    let expanded: string[];

    beforeEach(() => {
      dataTransfer = {
        data: {},
        setData(type: string, value: string) {
          this.data[type] = value;
        },
        effectAllowed: '',
        dropEffect: '',
      };
      moves = [];
      expanded = [];
      fixture.componentInstance.moveNote.subscribe((m) => moves.push(m));
      fixture.componentInstance.folderClick.subscribe((f) => expanded.push(f.id));
    });

    /** Fires a drag event at `target` like the browser would (bubbling, cancelable) and reports whether a drop was allowed. */
    function drag(type: string, target: Element, relatedTarget: Element | null = null): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }
    const host = () => root();
    const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('makes the note ROW draggable, and not its link (a link would drag its address instead)', () => {
      show();

      expect(rowNamed('Loose').getAttribute('draggable')).toBe('true');
      expect(rowNamed('Loose').querySelector('a')!.getAttribute('draggable')).toBe('false');
      expect(rowNamed('Work').getAttribute('draggable')).toBeNull(); // folders are not dragged
    });

    it('starts a drag carrying only the id of the note (and its title as plain text) and dims the row', () => {
      show();

      drag('dragstart', rowNamed('Loose'));

      expect(dataTransfer.data['application/x-inknote-note']).toBe('n3');
      expect(dataTransfer.data['text/plain']).toBe('Loose');
      expect(dataTransfer.effectAllowed).toBe('move');
      expect(rowNamed('Loose').classList).toContain('row--dragging');
    });

    it('welcomes a drop on a folder (cancels dragover, lights the folder) and reports the move', () => {
      show();
      drag('dragstart', rowNamed('Loose'));

      const over = drag('dragover', rowNamed('Work'));
      expect(over.defaultPrevented).toBe(true);
      expect(dataTransfer.dropEffect).toBe('move');
      expect(rowNamed('Work').classList).toContain('row--drop');

      drag('drop', rowNamed('Work'));
      expect(moves).toEqual([{ noteId: 'n3', notebookId: 'w' }]);
      expect(rowNamed('Work').classList).not.toContain('row--drop');
      expect(rowNamed('Loose').classList).not.toContain('row--dragging');
    });

    it('does not welcome a drop on the folder the note is already in, and reports nothing', () => {
      show(['w', 'p']);
      drag('dragstart', rowNamed('Plan')); // Plan is in Work

      const over = drag('dragover', rowNamed('Work'));
      drag('drop', rowNamed('Work'));

      expect(over.defaultPrevented).toBe(false);
      expect(rowNamed('Work').classList).not.toContain('row--drop');
      expect(moves).toEqual([]);
    });

    it('moves a note out of its folder when it is dropped on the empty space of the tree (top level)', () => {
      show(['w', 'p']);
      drag('dragstart', rowNamed('Roadmap')); // in Projects

      const over = drag('dragover', host());
      expect(over.defaultPrevented).toBe(true);
      expect(host().classList).toContain('drop-root');

      drag('drop', host());
      expect(moves).toEqual([{ noteId: 'n2', notebookId: null }]);
      expect(host().classList).not.toContain('drop-root');
    });

    it('a note that is already at the top level is not offered the top level', () => {
      show();
      drag('dragstart', rowNamed('Loose'));

      const over = drag('dragover', host());
      drag('drop', host());

      expect(over.defaultPrevented).toBe(false);
      expect(moves).toEqual([]);
    });

    it('a drop on a folder does not ALSO count as a drop on the empty space behind it', () => {
      show(['w', 'p']);
      drag('dragstart', rowNamed('Roadmap'));

      drag('dragover', rowNamed('Work'));
      drag('drop', rowNamed('Work'));

      expect(moves).toEqual([{ noteId: 'n2', notebookId: 'w' }]);
    });

    it('a note row stands for its own folder: dropping on it moves the note there', () => {
      show(['w', 'p']);
      drag('dragstart', rowNamed('Loose'));

      drag('dragover', rowNamed('Roadmap')); // Roadmap is in Projects
      expect(rowNamed('Projects').classList).toContain('row--drop'); // the folder it would land in is lit
      drag('drop', rowNamed('Roadmap'));

      expect(moves).toEqual([{ noteId: 'n3', notebookId: 'p' }]);
    });

    it('ignores anything that is not a note dragged here (a file from the desktop, selected text)', () => {
      show();

      const over = drag('dragover', rowNamed('Work')); // no dragstart of ours before
      drag('drop', rowNamed('Work'));

      expect(over.defaultPrevented).toBe(false);
      expect(moves).toEqual([]);
    });

    it('forgets the drag when it ends without a drop (Esc, dropped elsewhere)', () => {
      show();
      drag('dragstart', rowNamed('Loose'));
      drag('dragover', rowNamed('Work'));

      drag('dragend', rowNamed('Loose'));

      expect(rowNamed('Loose').classList).not.toContain('row--dragging');
      expect(rowNamed('Work').classList).not.toContain('row--drop');
    });

    it('unlights the folder when the pointer leaves the tree', () => {
      show();
      drag('dragstart', rowNamed('Loose'));
      drag('dragover', rowNamed('Work'));

      drag('dragleave', rowNamed('Work'), document.body);

      expect(rowNamed('Work').classList).not.toContain('row--drop');
    });

    describe('opening a closed folder while hovering over it', () => {
      // These two need a different delay, so they build their own component (the outer beforeEach made one already).
      it('opens it after a short rest, so a note can be dropped into a sub-folder in one gesture', async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [ExplorerTreeComponent],
          providers: [provideRouter([]), provideUi(), NzContextMenuService, { provide: DRAG_EXPAND_DELAY_MS, useValue: 15 }],
        }).compileComponents();
        fixture = TestBed.createComponent(ExplorerTreeComponent);
        fixture.componentInstance.folderClick.subscribe((f) => expanded.push(f.id));
        show(); // Work is closed and has a sub-folder
        drag('dragstart', rowNamed('Loose'));

        drag('dragover', rowNamed('Work'));
        drag('dragover', rowNamed('Work')); // dragover repeats all the time: still ONE opening
        await waitFor(60);

        expect(expanded).toEqual(['w']);
      });

      it('does not open it when the pointer moved away first', async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [ExplorerTreeComponent],
          providers: [provideRouter([]), provideUi(), NzContextMenuService, { provide: DRAG_EXPAND_DELAY_MS, useValue: 40 }],
        }).compileComponents();
        fixture = TestBed.createComponent(ExplorerTreeComponent);
        fixture.componentInstance.folderClick.subscribe((f) => expanded.push(f.id));
        show();
        drag('dragstart', rowNamed('Loose'));

        drag('dragover', rowNamed('Work'));
        drag('dragleave', rowNamed('Work'), document.body);
        await waitFor(100);

        expect(expanded).toEqual([]);
      });
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
