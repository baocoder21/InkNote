import { Notebook } from '../models/organization.model';
import { buildNotebookTree, flattenNotebooks } from './notebook-tree';

const nb = (id: string, name: string, parentId: string | null = null): Notebook => ({ id, name, parentId });

describe('buildNotebookTree', () => {
  it('nests children under their parent and sorts every level by name', () => {
    const tree = buildNotebookTree([
      nb('c', 'child-b', 'p'),
      nb('p', 'Parent'),
      nb('a', 'alpha'),
      nb('d', 'child-a', 'p'),
      nb('g', 'grandchild', 'd'),
    ]);

    expect(tree.map((n) => n.notebook.name)).toEqual(['alpha', 'Parent']); // case-insensitive
    const parent = tree[1];
    expect(parent.children.map((n) => n.notebook.name)).toEqual(['child-a', 'child-b']);
    expect(parent.children[0].children.map((n) => n.notebook.id)).toEqual(['g']);
  });

  it('puts a notebook with an unknown parent at the top level instead of losing it', () => {
    const tree = buildNotebookTree([nb('x', 'Orphan', 'does-not-exist')]);

    expect(tree.map((n) => n.notebook.id)).toEqual(['x']);
  });

  it('returns an empty tree for no notebooks', () => {
    expect(buildNotebookTree([])).toEqual([]);
  });
});

describe('flattenNotebooks', () => {
  it('lists the tree depth-first with the depth of each notebook', () => {
    const flat = flattenNotebooks(
      buildNotebookTree([nb('p', 'Parent'), nb('c', 'Child', 'p'), nb('g', 'Grandchild', 'c'), nb('z', 'Zed')]),
    );

    expect(flat.map((o) => [o.notebook.id, o.depth])).toEqual([
      ['p', 0],
      ['c', 1],
      ['g', 2],
      ['z', 0],
    ]);
    expect(flat.map((o) => o.path)).toEqual(['Parent', 'Parent / Child', 'Parent / Child / Grandchild', 'Zed']);
  });
});
