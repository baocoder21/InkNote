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
}

// The list endpoint does not return the content.
export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  version: number;
}

export interface CreateNoteRequest {
  title: string;
  content: string;
}

export interface UpdateNoteRequest {
  title: string;
  content: string;
  // The version the client last saw; the server answers 409 if it is outdated.
  version: number;
}
