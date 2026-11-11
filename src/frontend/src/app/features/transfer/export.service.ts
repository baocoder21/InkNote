import { Injectable, inject } from '@angular/core';
import { Zippable, strToU8, zipSync } from 'fflate';
import { AttachmentResolver } from '../attachments/services/attachment-resolver.service';
import { LocalNotebook } from '../sync/local/local-db';
import { NoteFileData, serializeNoteFile } from './note-file';
import { ExportRow, TransferRepository } from './transfer-repository';
import { relativeLink, safeName, uniqueName } from './zip-paths';

/** The folder of the attached files inside the zip. The leading underscore keeps it apart from the user's notebooks. */
export const ATTACHMENTS_FOLDER = '_attachments';

/** A file that says what this zip is (so that a later version of InkNote, or a person, can tell). Ignored on import. */
export const MANIFEST_FILE = '_inknote.json';

/** How an attachment is written in a note's Markdown: ![name](attachment:<id>) or [name](attachment:<id>). */
const ATTACHMENT_LINK = /\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export interface ExportResult {
  blob: Blob;
  fileName: string;
  notes: number;
  attachments: number;
  /** Files the notes refer to that could not be included (not on this device and the server cannot be reached). */
  missingAttachments: number;
}

/**
 * Folder of each notebook inside the zip, as a list of names from the top. Names are made safe for any file system,
 * and two notebooks with the same name in the same place get "(2)": nothing is merged or lost. A notebook whose
 * parent is missing (or that is part of a cycle) is put at the top.
 */
export function notebookFolders(notebooks: readonly Pick<LocalNotebook, 'id' | 'name' | 'parentId'>[]): Map<string, string[]> {
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const folders = new Map<string, string[]>();
  const takenIn = new Map<string, Set<string>>(); // parent folder -> names used in it

  const folderOf = (id: string, visiting: Set<string>): string[] => {
    const known = folders.get(id);
    if (known) return known;

    const notebook = byId.get(id)!;
    visiting.add(id);
    const parent = notebook.parentId && byId.has(notebook.parentId) && !visiting.has(notebook.parentId) ? folderOf(notebook.parentId, visiting) : [];
    visiting.delete(id);

    const key = parent.join('/');
    const taken = takenIn.get(key) ?? new Set<string>();
    takenIn.set(key, taken);
    const folder = [...parent, uniqueName(safeName(notebook.name, 80, 'Notebook'), '', taken)];
    folders.set(id, folder);
    return folder;
  };

  // In name order, so that the same notebooks always give the same folders.
  for (const notebook of [...notebooks].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    folderOf(notebook.id, new Set());
  }
  return folders;
}

/**
 * Takes the user's notes out of the app: a zip of Markdown files (one folder per notebook, front matter with the
 * title, tags, status and pin) that any Markdown tool can open, with the attached files in "_attachments" and links
 * to them written as ordinary relative links. Reads the database of THIS device, so it works offline; only a file
 * that was never opened on this device needs the server.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly data = inject(TransferRepository);
  private readonly attachments = inject(AttachmentResolver);

  /** Every note (not the ones in the trash) with its notebook folders, tags and attachments, as one zip. */
  async exportAll(now: Date = new Date()): Promise<ExportResult> {
    const [notes, notebooks, tags] = await Promise.all([this.data.notes(), this.data.notebooks(), this.data.tags()]);
    const folders = notebookFolders(notebooks);
    const build = await this.pack(notes, folders, new Map(tags.map((t) => [t.id, t.name])), now);

    const files = build.files;
    for (const folder of folders.values()) {
      files[`${folder.join('/')}/`] = new Uint8Array(0); // a notebook with no notes still exists
    }
    return {
      blob: new Blob([zipSync(files)], { type: 'application/zip' }),
      fileName: `inknote-export-${isoDay(now)}.zip`,
      notes: notes.length,
      attachments: build.attachments,
      missingAttachments: build.missing,
    };
  }

  /** One note: a single .md file, or a zip when it has attached files. null when the note does not exist. */
  async exportNote(noteId: string, now: Date = new Date()): Promise<ExportResult | null> {
    const note = await this.data.note(noteId);
    if (!note) {
      return null;
    }
    const tags = new Map((await this.data.tags()).map((t) => [t.id, t.name]));
    const build = await this.pack([note], new Map(), tags, now, { flat: true });

    const name = safeName(note.title);
    if (build.attachments === 0) {
      const [path] = Object.keys(build.files).filter((p) => p.endsWith('.md'));
      const markdown = build.texts.get(path) ?? '';
      return { blob: new Blob([markdown], { type: 'text/markdown' }), fileName: `${name}.md`, notes: 1, attachments: 0, missingAttachments: build.missing };
    }
    return { blob: new Blob([zipSync(build.files)], { type: 'application/zip' }), fileName: `${name}.zip`, notes: 1, attachments: build.attachments, missingAttachments: build.missing };
  }

  // ---------------------------------------------------------------------------------------------------------------

  private async pack(
    notes: readonly ExportRow[],
    folders: ReadonlyMap<string, string[]>,
    tagNames: ReadonlyMap<string, string>,
    now: Date,
    options: { flat?: boolean } = {},
  ): Promise<{ files: Zippable; texts: Map<string, string>; attachments: number; missing: number }> {
    const files: Zippable = {};
    const texts = new Map<string, string>(); // the Markdown of each note file (to hand back as a plain .md)
    const takenIn = new Map<string, Set<string>>();
    const attachmentPaths = new Map<string, string[] | null>(); // attachment id -> its path in the zip (null: not available)
    const takenAttachmentFolders = new Set<string>();
    let attachmentCount = 0;
    let missing = 0;

    const addAttachment = async (id: string): Promise<string[] | null> => {
      if (attachmentPaths.has(id)) return attachmentPaths.get(id)!;
      const file = await this.attachments.bytes(id);
      if (!file) {
        attachmentPaths.set(id, null);
        missing++;
        return null;
      }
      // One folder per file (named after the start of its id), so that the file keeps its own name, and two files with
      // the same name cannot collide.
      const path = [ATTACHMENTS_FOLDER, uniqueName(id.slice(0, 8), '', takenAttachmentFolders), safeName(file.name, 100, 'file')];
      attachmentPaths.set(id, path);
      // Pictures and PDFs are compressed already: storing them as they are is faster and not larger.
      files[path.join('/')] = [new Uint8Array(file.data), { level: 0 }];
      attachmentCount++;
      return path;
    };

    for (const note of [...notes].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
      const dir = options.flat ? [] : (note.notebookId ? (folders.get(note.notebookId) ?? []) : []);
      const taken = takenIn.get(dir.join('/')) ?? new Set<string>();
      takenIn.set(dir.join('/'), taken);
      const fileName = uniqueName(safeName(note.title), '.md', taken);

      // attachment:<id> becomes a link that works anywhere: from the folder of THIS note to the file.
      const content = await replaceAsync(note.content, ATTACHMENT_LINK, async (whole, id: string) => {
        const path = await addAttachment(id.toLowerCase());
        return path ? `](${relativeLink(dir, path)})` : whole;
      });

      const data: NoteFileData = {
        title: note.title,
        content,
        tags: note.tagIds.map((id) => tagNames.get(id)).filter((n): n is string => !!n),
        status: note.status,
        pinned: note.isPinned,
        createdAt: note.createdAt || undefined,
        updatedAt: note.updatedAt || undefined,
      };
      const path = [...dir, fileName].join('/');
      const markdown = serializeNoteFile(data);
      texts.set(path, markdown);
      files[path] = strToU8(markdown);
    }

    files[MANIFEST_FILE] = strToU8(JSON.stringify({ format: 'inknote-export', version: 1, exportedAt: now.toISOString(), notes: notes.length }, null, 2));
    return { files, texts, attachments: attachmentCount, missing };
  }
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** String.replace where the replacement is worked out by an async function. The calls run one after the other. */
async function replaceAsync(text: string, pattern: RegExp, replacer: (match: string, ...groups: string[]) => Promise<string>): Promise<string> {
  const matches = [...text.matchAll(pattern)];
  let result = '';
  let last = 0;
  for (const match of matches) {
    result += text.slice(last, match.index) + (await replacer(match[0], ...match.slice(1)));
    last = match.index + match[0].length;
  }
  return result + text.slice(last);
}
