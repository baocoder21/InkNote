import { Injectable, inject } from '@angular/core';
import { AttachmentRepository, readBytes } from '../attachments/data/attachment-repository';
import { typeFromName } from '../attachments/models/attachment.model';
import { NotesRepository } from '../notes/data/notes-repository';
import { OrganizationRepository } from '../notes/data/organization-repository';
import { NOTE_LIMITS } from '../notes/models/note.model';
import { ATTACHMENTS_FOLDER, MANIFEST_FILE } from './export.service';
import { parseNoteFile } from './note-file';
import { DEFAULT_ZIP_LIMITS, ZipEntry, ZipError, ZipLimits, readZip } from './zip-reader';
import { pathKey, resolveLink } from './zip-paths';

export interface ImportReport {
  notes: number;
  notebooksCreated: number;
  tagsCreated: number;
  attachments: number;
  /** Things that were left out, and why: the user must be able to see that something did not come in. */
  skipped: { name: string; reason: string }[];
  /** Files of a zip that were neither notes nor referred to by a note. */
  unusedFiles: number;
}

const NOTE_FILE = /\.(md|markdown|txt)$/i;
const NOTEBOOK_NAME_MAX = 100;

/** [text](target "title") and ![alt](target): the part in () is what we may have to rewrite. */
const LINK = /(\[[^\]\n]*\])\(\s*(<[^>\n]*>|[^)\s]*)((?:\s+"[^"\n]*")?)\s*\)/g;

/**
 * Brings notes in: Markdown files (.md, .markdown, .txt) and zips of them, ours or from another app.
 *  - a folder of the zip becomes a notebook (nested folders, nested notebooks), and an existing notebook of the same
 *    name in the same place is reused;
 *  - the `tags` of the front matter become tags (an existing tag of the same name, ignoring case, is reused);
 *  - a note's front matter gives its title, status and pin; with none, the first "# heading" or the file name is the title;
 *  - a link to an image or PDF that is in the zip becomes an attached file of the note.
 * Everything is written through the ordinary repositories: to THIS device first, and then to the server by the
 * synchronization like anything else. Nothing is overwritten: importing twice makes copies.
 */
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly notes = inject(NotesRepository);
  private readonly org = inject(OrganizationRepository);
  private readonly attachments = inject(AttachmentRepository);

  async importFiles(files: readonly File[], limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ImportReport> {
    const report: ImportReport = { notes: 0, notebooksCreated: 0, tagsCreated: 0, attachments: 0, skipped: [], unusedFiles: 0 };
    const found: ZipEntry[] = [];
    const folders: string[][] = [];

    for (const file of files) {
      await this.collect(file, limits, found, folders, report);
    }

    const context = await this.start(report);
    const byPath = new Map(found.map((entry) => [pathKey(entry.path), entry.bytes]));
    const used = new Set<string>();

    for (const folder of folders) {
      if (folder[0] !== ATTACHMENTS_FOLDER) {
        await context.notebook(folder); // a notebook with no notes
      }
    }

    const noteEntries = found
      .filter((e) => NOTE_FILE.test(e.path[e.path.length - 1]) && e.path[0] !== ATTACHMENTS_FOLDER)
      .sort((a, b) => pathKey(a.path).localeCompare(pathKey(b.path)));
    for (const entry of noteEntries) {
      used.add(pathKey(entry.path));
      try {
        await this.importNote(entry, byPath, used, context, report);
      } catch {
        report.skipped.push({ name: entry.path.join('/'), reason: 'it could not be imported' });
      }
    }

    report.unusedFiles = found.filter((e) => !used.has(pathKey(e.path)) && e.path.join('/') !== MANIFEST_FILE).length;
    return report;
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** Opens one chosen file: a zip is unpacked, a text file is taken as it is, anything else is reported. */
  private async collect(file: File, limits: ZipLimits, found: ZipEntry[], folders: string[][], report: ImportReport): Promise<void> {
    if (file.size > limits.maxTotalBytes) {
      report.skipped.push({ name: file.name, reason: 'the file is too large' });
      return;
    }
    const bytes = new Uint8Array(await readBytes(file));

    if (looksLikeZip(file.name, bytes)) {
      try {
        const contents = readZip(bytes, limits);
        found.push(...contents.files);
        folders.push(...contents.directories);
        for (const s of contents.skipped) {
          report.skipped.push({ name: `${file.name}: ${s.path}`, reason: s.reason });
        }
      } catch (error) {
        if (!(error instanceof ZipError)) throw error;
        report.skipped.push({ name: file.name, reason: error.message });
      }
      return;
    }

    if (NOTE_FILE.test(file.name)) {
      if (bytes.length > limits.maxEntryBytes) {
        report.skipped.push({ name: file.name, reason: 'the file is too large' });
      } else {
        found.push({ path: [file.name.replace(/^.*[\\/]/, '')], bytes });
      }
      return;
    }
    report.skipped.push({ name: file.name, reason: 'only .md, .markdown, .txt and .zip files can be imported' });
  }

  /** The folders and tags that already exist are reused: this keeps what the import needs to ask about them. */
  private async start(report: ImportReport) {
    const notebooks = new Map<string, string>(); // "parentId/name" (lower case) -> id
    for (const n of await this.org.listNotebooks()) {
      notebooks.set(`${n.parentId ?? ''}/${n.name.toLowerCase()}`, n.id);
    }
    const tags = new Map((await this.org.listTags()).map((t) => [t.name.toLowerCase(), t.id]));

    return {
      /** The notebook for a folder path (creating the missing ones); null for "no notebook". */
      notebook: async (path: readonly string[]): Promise<string | null> => {
        let parentId: string | null = null;
        for (const raw of path) {
          const name = raw.trim().slice(0, NOTEBOOK_NAME_MAX).trim();
          if (!name) continue;
          const key = `${parentId ?? ''}/${name.toLowerCase()}`;
          let id = notebooks.get(key);
          if (!id) {
            id = (await this.org.createNotebook(name, parentId)).id;
            notebooks.set(key, id);
            report.notebooksCreated++;
          }
          parentId = id;
        }
        return parentId;
      },
      tag: async (name: string): Promise<string | null> => {
        const key = name.toLowerCase();
        let id = tags.get(key);
        if (!id) {
          const created = await this.org.createTag(name);
          if (created.status !== 'ok') return null; // appeared meanwhile
          id = created.tag.id;
          tags.set(key, id);
          report.tagsCreated++;
        }
        return id;
      },
    };
  }

  private async importNote(
    entry: ZipEntry,
    byPath: ReadonlyMap<string, Uint8Array>,
    used: Set<string>,
    context: Awaited<ReturnType<ImportService['start']>>,
    report: ImportReport,
  ): Promise<void> {
    const where = entry.path.join('/');
    if (entry.bytes.includes(0)) {
      report.skipped.push({ name: where, reason: 'it is not a text file' });
      return;
    }

    const parsed = parseNoteFile(new TextDecoder('utf-8').decode(entry.bytes), entry.path[entry.path.length - 1]);
    if (parsed.content.length > NOTE_LIMITS.contentMaxLength) {
      report.skipped.push({ name: where, reason: `the text is longer than ${NOTE_LIMITS.contentMaxLength.toLocaleString('en-US')} characters` });
      return;
    }

    const dir = entry.path.slice(0, -1);
    const notebookId = await context.notebook(dir);
    const tagIds: string[] = [];
    for (const name of parsed.tags) {
      const id = await context.tag(name);
      if (id) tagIds.push(id);
    }

    // The note first, then its files: a file is only uploaded once the note is known to the server.
    const note = await this.notes.create(parsed.title, parsed.content, notebookId);
    const content = await this.attachLinkedFiles(note.id, dir, where, parsed.content, byPath, used, report);
    if (content !== parsed.content) {
      await this.notes.saveText(note.id, parsed.title, content);
    }
    if (tagIds.length > 0 || parsed.status !== null || parsed.pinned !== null) {
      await this.notes.updateOrganization(note.id, { notebookId, isPinned: parsed.pinned ?? false, status: parsed.status ?? 'None', tagIds });
    }
    report.notes++;
  }

  /**
   * Links to files that are inside the zip become attached files of the note. Anything else (a web address, a link
   * to a note, a file that is not in the zip, a kind of file that is not allowed) is left exactly as written.
   */
  private async attachLinkedFiles(
    noteId: string,
    dir: readonly string[],
    where: string,
    content: string,
    byPath: ReadonlyMap<string, Uint8Array>,
    used: Set<string>,
    report: ImportReport,
  ): Promise<string> {
    const made = new Map<string, string | null>(); // path key -> attachment id (null: it could not be attached)
    const edits: { start: number; end: number; text: string }[] = [];

    for (const match of content.matchAll(LINK)) {
      const [whole, label, target] = match;
      if (/^attachment:/i.test(target)) continue;
      const path = resolveLink(dir, target);
      const key = path ? pathKey(path) : null;
      const bytes = key ? byPath.get(key) : undefined;
      if (!path || !key || !bytes || NOTE_FILE.test(path[path.length - 1])) continue; // not a file that came in the zip (or a note: a link between notes stays a link)

      let id = made.get(key);
      if (id === undefined) {
        id = await this.attach(noteId, path, bytes, where, report);
        made.set(key, id);
      }
      if (id) {
        used.add(key);
        edits.push({ start: match.index, end: match.index + whole.length, text: `${label}(attachment:${id})` });
      }
    }

    let result = '';
    let last = 0;
    for (const edit of edits) {
      result += content.slice(last, edit.start) + edit.text;
      last = edit.end;
    }
    return result + content.slice(last);
  }

  private async attach(noteId: string, path: readonly string[], bytes: Uint8Array, where: string, report: ImportReport): Promise<string | null> {
    const name = path[path.length - 1];
    const file = new File([bytes as BlobPart], name, { type: typeFromName(name) });
    const result = await this.attachments.add(noteId, file);
    if (result.status === 'ok') {
      report.attachments++;
      return result.id;
    }
    const reason = result.reason.replace(/\.$/, '');
    report.skipped.push({ name: `${where} -> ${name}`, reason: `the file was not attached: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` });
    return null;
  }
}

/** A zip starts with "PK" and one of two signatures (a file, or an empty archive). The name alone is not trusted either way. */
function looksLikeZip(name: string, bytes: Uint8Array): boolean {
  const magic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
  return magic || (/\.zip$/i.test(name) && !NOTE_FILE.test(name));
}

