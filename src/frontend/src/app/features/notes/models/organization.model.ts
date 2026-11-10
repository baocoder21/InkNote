// Notebooks and tags (see NotebookDtos.cs and TagDtos.cs in the backend).

// Must match NotebookLimits / TagLimits in the backend.
export const ORGANIZATION_LIMITS = { notebookNameMaxLength: 100, tagNameMaxLength: 50 } as const;

export interface Notebook {
  id: string;
  name: string;
  parentId: string | null; // null = top level
}

export interface Tag {
  id: string;
  name: string;
}

/** A notebook with its sub-notebooks: the tree the sidebar draws (built on the client). */
export interface NotebookNode {
  notebook: Notebook;
  children: NotebookNode[];
}

/** A notebook in a flat, depth-first list (for pickers). */
export interface NotebookOption {
  notebook: Notebook;
  depth: number;
  // Full name with its ancestors, e.g. "Work / Projects": tells apart two sub-notebooks with the same name.
  path: string;
}
