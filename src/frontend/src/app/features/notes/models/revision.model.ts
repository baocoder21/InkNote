/** One entry of a note's history, without the whole text (the list is light on purpose: a note can have 50 of them). */
export interface NoteRevisionSummary {
  id: string;
  noteId: string;
  title: string;
  /** The first 200 characters of the text. */
  preview: string;
  contentLength: number;
  noteVersion: number;
  reason: string;
  createdAt: string;
}

/** An entry with its whole text (loaded when one is selected). */
export interface NoteRevision {
  id: string;
  noteId: string;
  title: string;
  content: string;
  noteVersion: number;
  reason: string;
  createdAt: string;
}

/** Why the server kept the text, in words for the user. */
export function revisionReasonLabel(reason: string): string {
  switch (reason) {
    case 'edit':
      return 'Before an edit';
    case 'conflict':
      return 'Replaced by a change from another device';
    case 'restore':
      return 'Before an older version was put back';
    default:
      return reason;
  }
}
