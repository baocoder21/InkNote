import { Notebook, NotebookNode, NotebookOption } from '../models/organization.model';

/** Case-insensitive, accent-aware ordering for names shown to the user. */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * The API returns notebooks as a flat list where each item names its parent.
 * This turns that list into a tree: group the items by parent, then hang each group
 * under its parent. Pure function (no state, no HTTP), so it is easy to test.
 */
export function buildNotebookTree(notebooks: Notebook[]): NotebookNode[] {
  const known = new Set(notebooks.map((n) => n.id));
  const childrenOf = new Map<string | null, Notebook[]>();

  for (const notebook of notebooks) {
    // A parent we do not know (should not happen) is treated as "top level" instead of
    // making the notebook disappear.
    const key = notebook.parentId !== null && known.has(notebook.parentId) ? notebook.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), notebook]);
  }

  const build = (parentId: string | null): NotebookNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort(byName)
      .map((notebook) => ({ notebook, children: build(notebook.id) }));

  return build(null);
}

/** Ids of the notebook's ancestors (parent, grandparent, ...), nearest first. */
export function ancestorIds(notebookId: string, notebooks: Notebook[]): string[] {
  const parentOf = new Map(notebooks.map((n) => [n.id, n.parentId]));
  const result: string[] = [];
  const seen = new Set<string>([notebookId]); // protects against a (never expected) loop
  for (let id = parentOf.get(notebookId); id && !seen.has(id); id = parentOf.get(id)) {
    result.push(id);
    seen.add(id);
  }
  return result;
}

/** Depth-first flat list of the tree, with depth and full path of each notebook (for a select box). */
export function flattenNotebooks(nodes: NotebookNode[], depth = 0, parentPath = ''): NotebookOption[] {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath} / ${node.notebook.name}` : node.notebook.name;
    return [
      { notebook: node.notebook, depth, path },
      ...flattenNotebooks(node.children, depth + 1, path),
    ];
  });
}
