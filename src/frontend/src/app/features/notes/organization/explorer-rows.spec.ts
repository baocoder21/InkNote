import { NoteSummary } from '../models/note.model';
import { Notebook } from '../models/organization.model';
import { buildExplorerRows, buildTagRows, ExplorerRow, sortNotesForTree } from './explorer-rows';
import { ancestorIds, buildNotebookTree } from './notebook-tree';

const nb = (id: string, name: string, parentId: string | null = null): Notebook => ({ id, name, parentId });

const note = (id: string, title: string, notebookId: string | null = null, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title,
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId,
  isPinned: false,
  status: 'None',
  tagIds: [],
  ...extra,
});

/** "folder:Work@0" / "note:Plan@1": compact form of a row for assertions. */
const show = (rows: ExplorerRow[]) =>
  rows.map((r) =>
    r.kind === 'folder'
      ? `folder:${r.notebook.name}@${r.depth}${r.expanded ? '-' : '+'}`
      : `note:${r.note.title}@${r.depth}`,
  );

describe('sortNotesForTree', () => {
  it('puts pinned notes first, then sorts by title ignoring case', () => {
    const sorted = sortNotesForTree([
      note('1', 'banana'),
      note('2', 'Zebra', null, { isPinned: true }),
      note('3', 'apple'),
    ]);

    expect(sorted.map((n) => n.title)).toEqual(['Zebra', 'apple', 'banana']);
  });
});

describe('buildExplorerRows', () => {
  const tree = buildNotebookTree([nb('w', 'Work'), nb('p', 'Projects', 'w'), nb('h', 'Home')]);
  const notes = [
    note('1', 'Plan', 'w'),
    note('2', 'Roadmap', 'p'),
    note('3', 'Loose note'),
    note('4', 'Groceries', 'h'),
  ];

  it('shows only the folders (collapsed) and the notes that are in no folder', () => {
    expect(show(buildExplorerRows(tree, notes, new Set()))).toEqual([
      'folder:Home@0+',
      'folder:Work@0+',
      'note:Loose note@0',
    ]);
  });

  it('shows the children of an expanded folder: sub-folders first, then its notes, one level deeper', () => {
    const rows = buildExplorerRows(tree, notes, new Set(['w']));

    expect(show(rows)).toEqual([
      'folder:Home@0+',
      'folder:Work@0-',
      'folder:Projects@1+',
      'note:Plan@1',
      'note:Loose note@0',
    ]);
  });

  it('goes as deep as the expanded folders go', () => {
    const rows = buildExplorerRows(tree, notes, new Set(['w', 'p']));

    expect(show(rows)).toContain('note:Roadmap@2');
  });

  it('marks folders with nothing inside as having no children (no chevron)', () => {
    const rows = buildExplorerRows(buildNotebookTree([nb('e', 'Empty')]), [], new Set());

    expect(rows[0]).toMatchObject({ kind: 'folder', hasChildren: false });
  });

  it('shows a note whose folder is unknown at the top level instead of losing it', () => {
    const rows = buildExplorerRows(tree, [note('9', 'Orphan', 'deleted-folder')], new Set());

    expect(show(rows)).toContain('note:Orphan@0');
  });
});

describe('buildTagRows', () => {
  it('lists only the notes with that tag, flat', () => {
    const rows = buildTagRows(
      [note('1', 'B', 'w', { tagIds: ['t'] }), note('2', 'A', null, { tagIds: ['t', 'u'] }), note('3', 'C')],
      't',
    );

    expect(show(rows)).toEqual(['note:A@0', 'note:B@0']);
  });
});

describe('ancestorIds', () => {
  const all = [nb('a', 'A'), nb('b', 'B', 'a'), nb('c', 'C', 'b')];

  it('lists the parents from the nearest to the root', () => {
    expect(ancestorIds('c', all)).toEqual(['b', 'a']);
    expect(ancestorIds('a', all)).toEqual([]);
    expect(ancestorIds('unknown', all)).toEqual([]);
  });

  it('does not loop forever if the data is circular', () => {
    expect(ancestorIds('x', [nb('x', 'X', 'y'), nb('y', 'Y', 'x')])).toEqual(['y']);
  });
});
