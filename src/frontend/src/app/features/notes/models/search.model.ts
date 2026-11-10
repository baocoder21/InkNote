// Shapes of GET /api/notes/search (see NoteSearchService.cs).
import { NoteStatus } from './note.model';

/**
 * A piece of text and whether it matched. The server sends the title and the snippet as lists of
 * these (never as HTML): the template draws the matches with a <mark> element, so no innerHTML
 * (which is allowed only for the sanitized Markdown preview) is involved.
 */
export interface TextPart {
  text: string;
  match: boolean;
}

export interface SearchResult {
  id: string;
  title: TextPart[];
  snippet: TextPart[];
  updatedAt: string;
  notebookId: string | null;
  isPinned: boolean;
  status: NoteStatus;
  tagIds: string[];
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

/** Shortest query that is searched (one letter would match almost everything). */
export const SEARCH_MIN_LENGTH = 2;
/** Same limit as the server (SearchLimits.QueryMaxLength). */
export const SEARCH_MAX_LENGTH = 100;
