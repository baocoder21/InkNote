// Shapes of the JSON sent/received by the backend (see NoteDtos.cs).
// Dates arrive as ISO-8601 strings.

// Must match NoteLimits.cs in the backend, which rejects anything longer with 400.
export const NOTE_LIMITS = { titleMaxLength: 200, contentMaxLength: 500_000 } as const;

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  notebookId: string | null; // null = not in any notebook
  isPinned: boolean;
  status: NoteStatus;
  tagIds: string[];
}

// The list endpoint does not return the content.
export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  version: number;
  notebookId: string | null;
  isPinned: boolean;
  status: NoteStatus;
  tagIds: string[];
}

export interface CreateNoteRequest {
  title: string;
  content: string;
  notebookId?: string; // optional: file the new note straight into a notebook
}

export interface UpdateNoteRequest {
  title: string;
  content: string;
  // The version the client last saw; the server answers 409 if it is outdated.
  version: number;
}

/** Where a note lives and how it is labelled; sent without touching its text. */
export interface NoteOrganization {
  notebookId: string | null;
  isPinned: boolean;
  status: NoteStatus;
  tagIds: string[]; // the complete set of tags the note should have afterwards
}

export interface UpdateNoteOrganizationRequest extends NoteOrganization {
  version: number;
}

/** Same names as the backend enum NoteStatus (the API sends and expects the NAME). */
export type NoteStatus = 'None' | 'Active' | 'OnHold' | 'Completed' | 'Dropped';

export const NOTE_STATUS_OPTIONS: readonly { value: NoteStatus; label: string }[] = [
  { value: 'None', label: 'No status' },
  { value: 'Active', label: 'Active' },
  { value: 'OnHold', label: 'On hold' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Dropped', label: 'Dropped' },
];
