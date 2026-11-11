import { NOTE_LIMITS, NoteStatus } from '../notes/models/note.model';

/**
 * The format of an exported note: a Markdown file that starts with "front matter", a block between two lines of
 * three dashes that holds what is NOT the text (title, tags, status, pinned). Every Markdown tool knows the layout
 * (Obsidian, Jekyll, Hugo...), and the file is readable without InkNote:
 *
 *     ---
 *     title: "Weekly plan"
 *     tags: ["work", "plan"]
 *     status: Active
 *     pinned: true
 *     created: "2026-03-04T09:00:00.000Z"
 *     ---
 *
 *     # The text of the note...
 *
 * Strings are written as JSON strings (a valid form in YAML): quotes, colons and line breaks in a title cannot confuse
 * the reader. The reader is more forgiving than the writer, because it also reads files that other tools wrote.
 */
export interface NoteFileData {
  title: string;
  content: string;
  tags: string[];
  status: NoteStatus;
  pinned: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** What was found in a file. null = the file does not say (leave the default). */
export interface ParsedNote {
  title: string;
  content: string;
  tags: string[];
  status: NoteStatus | null;
  pinned: boolean | null;
}

export const TAG_NAME_MAX = 50;

export function serializeNoteFile(note: NoteFileData): string {
  const lines = [`title: ${JSON.stringify(note.title)}`];
  if (note.tags.length > 0) lines.push(`tags: [${note.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  if (note.status !== 'None') lines.push(`status: ${note.status}`);
  if (note.pinned) lines.push('pinned: true');
  if (note.createdAt) lines.push(`created: ${JSON.stringify(note.createdAt)}`);
  if (note.updatedAt) lines.push(`updated: ${JSON.stringify(note.updatedAt)}`);
  // A blank line after the closing dashes, so the file reads well; the reader removes exactly that one.
  return `---\n${lines.join('\n')}\n---\n\n${note.content}`;
}

export function parseNoteFile(text: string, fileName: string): ParsedNote {
  const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const front = splitFrontMatter(source);
  const fields = front ? readFields(front.block) : new Map<string, string | string[]>();
  let body = front ? front.body : source;
  if (front && body.startsWith('\n')) {
    body = body.slice(1); // the blank line the writer puts after the front matter
  }

  let title = oneLine(asString(fields.get('title')));
  if (!title) {
    // A file with no title of its own: a first line "# Heading" is the title, and is not repeated in the text.
    const start = body.replace(/^\n+/, '');
    const heading = /^#[ \t]+([^\n]+)\n?/.exec(start);
    if (heading) {
      title = oneLine(heading[1].replace(/[ \t]+#+[ \t]*$/, ''));
      body = start.slice(heading[0].length).replace(/^\n/, '');
    }
  }
  if (!title) {
    title = oneLine(fileName.replace(/^.*[\\/]/, '').replace(/\.(md|markdown|txt)$/i, ''));
  }
  title = (title || 'Untitled').slice(0, NOTE_LIMITS.titleMaxLength).trim() || 'Untitled';

  return {
    title,
    content: body,
    tags: readTags(fields.get('tags') ?? fields.get('tag')),
    status: readStatus(asString(fields.get('status'))),
    pinned: readBool(asString(fields.get('pinned') ?? fields.get('pin'))),
  };
}

// ---------------------------------------------------------------------------------------------------------------

/** The text between a first line of "---" and the next "---" (or "..."), and what follows it. */
function splitFrontMatter(source: string): { block: string; body: string } | null {
  if (!/^---[ \t]*\n/.test(source)) {
    return null;
  }
  const lines = source.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      return { block: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    }
  }
  return null; // never closed: it is not front matter, it is text that starts with a rule
}

/** key: value lines, and "- item" lines that belong to the key above them (a YAML list). Anything else is ignored. */
function readFields(block: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  let listKey: string | null = null;
  for (const line of block.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null);
    if (item && listKey) {
      const current = fields.get(listKey);
      fields.set(listKey, [...(Array.isArray(current) ? current : []), unquote(item[1].trim())]);
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      continue;
    }
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    listKey = value === '' ? key : null;
    fields.set(key, value === '' ? [] : value.startsWith('[') ? readInlineList(value) : unquote(value));
  }
  return fields;
}

/** ["a", b, 'c'] -> ["a", "b", "c"]; commas inside quotes belong to the item. */
function readInlineList(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]\s*$/, '');
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) current += inner[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((i) => unquote(i.trim())).filter((i) => i !== '');
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

const asString = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

function readTags(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? value.split(',') : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = oneLine(item.replace(/^#/, '')).slice(0, TAG_NAME_MAX).trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

function readStatus(value: string): NoteStatus | null {
  switch (value.toLowerCase().replace(/[\s_-]/g, '')) {
    case 'none':
      return 'None';
    case 'active':
      return 'Active';
    case 'onhold':
      return 'OnHold';
    case 'completed':
      return 'Completed';
    case 'dropped':
      return 'Dropped';
    default:
      return null;
  }
}

function readBool(value: string): boolean | null {
  switch (value.toLowerCase()) {
    case 'true':
    case 'yes':
      return true;
    case 'false':
    case 'no':
      return false;
    default:
      return null;
  }
}
