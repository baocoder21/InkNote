import { NoteSummary } from '../models/note.model';
import { Notebook, NotebookNode } from '../models/organization.model';
import { byName } from './notebook-tree';

/**
 * One visible line of the sidebar tree. The tree is drawn as a flat list of rows, each knowing
 * its depth (indentation): simpler to render than nested lists, and it is also how editors
 * like VS Code draw their file explorer.
 */
export type ExplorerRow =
  | { kind: 'folder'; notebook: Notebook; depth: number; expanded: boolean; hasChildren: boolean }
  | { kind: 'note'; note: NoteSummary; depth: number };

/**
 * Order of notes inside a folder: pinned first, then by title. Not by "last edited": while you
 * type, autosave changes that date and the note would jump around under your cursor.
 */
export function sortNotesForTree(notes: NoteSummary[]): NoteSummary[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      byName({ name: a.title }, { name: b.title }),
  );
}

/**
 * Turns the folder tree plus the notes into the rows to draw. Inside a folder, sub-folders come
 * first, then its notes; notes that are in no folder come last, at the top level.
 * Only the children of EXPANDED folders produce rows.
 */
export function buildExplorerRows(
  tree: NotebookNode[],
  notes: NoteSummary[],
  expanded: ReadonlySet<string>,
): ExplorerRow[] {
  const knownFolders = new Set<string>();
  const collect = (nodes: NotebookNode[]): void =>
    nodes.forEach((n) => {
      knownFolders.add(n.notebook.id);
      collect(n.children);
    });
  collect(tree);

  // Group the notes by folder. A note pointing to an unknown folder is shown at the top level
  // instead of disappearing.
  const notesIn = new Map<string | null, NoteSummary[]>();
  for (const note of sortNotesForTree(notes)) {
    const key = note.notebookId !== null && knownFolders.has(note.notebookId) ? note.notebookId : null;
    notesIn.set(key, [...(notesIn.get(key) ?? []), note]);
  }

  const noteRow = (note: NoteSummary, depth: number): ExplorerRow => ({ kind: 'note', note, depth });

  const walk = (nodes: NotebookNode[], depth: number): ExplorerRow[] =>
    nodes.flatMap((node) => {
      const here = notesIn.get(node.notebook.id) ?? [];
      const isOpen = expanded.has(node.notebook.id);
      const folder: ExplorerRow = {
        kind: 'folder',
        notebook: node.notebook,
        depth,
        expanded: isOpen,
        hasChildren: node.children.length > 0 || here.length > 0,
      };
      return isOpen
        ? [folder, ...walk(node.children, depth + 1), ...here.map((n) => noteRow(n, depth + 1))]
        : [folder];
    });

  return [...walk(tree, 0), ...(notesIn.get(null) ?? []).map((n) => noteRow(n, 0))];
}

/** Rows for a tag filter: just the matching notes, flat (no folders). */
export function buildTagRows(notes: NoteSummary[], tagId: string): ExplorerRow[] {
  return sortNotesForTree(notes.filter((n) => n.tagIds.includes(tagId))).map((note) => ({
    kind: 'note' as const,
    note,
    depth: 0,
  }));
}
