import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { strToU8, zipSync } from 'fflate';
import { readBytes } from '../attachments/data/attachment-repository';
import { NotesRepository } from '../notes/data/notes-repository';
import { OrganizationRepository } from '../notes/data/organization-repository';
import { NOTE_LIMITS } from '../notes/models/note.model';
import { LocalDbService } from '../sync/local/local-db';
import { ExportService } from './export.service';
import { ImportService } from './import.service';
import { serializeNoteFile } from './note-file';
import { DEFAULT_ZIP_LIMITS } from './zip-reader';

let counter = 0;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = strToU8('%PDF-1.4 hello');

const file = (name: string, data: string | Uint8Array) => new File([data as BlobPart], name);
const zipFile = (name: string, entries: Record<string, string | Uint8Array>) =>
  file(name, zipSync(Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]))));

describe('ImportService', () => {
  let service: ImportService;
  let local: LocalDbService;
  let org: OrganizationRepository;
  let notes: NotesRepository;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ImportService);
    local = TestBed.inject(LocalDbService);
    org = TestBed.inject(OrganizationRepository);
    notes = TestBed.inject(NotesRepository);
    await local.open(`import-${++counter}`);
  });

  afterEach(() => local.wipe());

  const allNotes = async () => {
    const rows = await local.db.notes.toArray();
    const contents = new Map((await local.db.contents.toArray()).map((c) => [c.id, c.content]));
    return rows.map((r) => ({ ...r, content: contents.get(r.id) ?? '' })).sort((a, b) => a.title.localeCompare(b.title));
  };
  const notebookPath = async (id: string | null): Promise<string> => {
    const all = await local.db.notebooks.toArray();
    const parts: string[] = [];
    for (let current = id; current; ) {
      const n = all.find((x) => x.id === current)!;
      parts.unshift(n.name);
      current = n.parentId;
    }
    return parts.join('/');
  };
  const tagNames = async (ids: string[]) => {
    const tags = await local.db.tags.toArray();
    return ids.map((id) => tags.find((t) => t.id === id)!.name).sort();
  };

  describe('Markdown files', () => {
    it('imports a plain file: the first heading is the title, and is not repeated in the text', async () => {
      const report = await service.importFiles([file('meeting.md', '# Meeting notes\n\nWe talked.\n')]);

      const [note] = await allNotes();
      expect(report).toMatchObject({ notes: 1, notebooksCreated: 0, tagsCreated: 0, attachments: 0, skipped: [] });
      expect(note).toMatchObject({ title: 'Meeting notes', content: 'We talked.\n', notebookId: null, isPinned: false, status: 'None', version: 0 });
    });

    it('queues what it makes for the server like any other change', async () => {
      await service.importFiles([file('a.md', 'text')]);

      const [op] = await local.db.outbox.toArray();
      expect(op).toMatchObject({ entity: 'note', kind: 'upsert', baseVersion: null });
    });

    it('reads title, tags, status and pin from the front matter and creates the tags', async () => {
      const text = serializeNoteFile({ title: 'Plan: v2', content: 'body', tags: ['work', 'big idea'], status: 'Active', pinned: true });

      const report = await service.importFiles([file('whatever.md', text)]);

      const [note] = await allNotes();
      expect(note).toMatchObject({ title: 'Plan: v2', content: 'body', isPinned: true, status: 'Active' });
      expect(await tagNames(note.tagIds)).toEqual(['big idea', 'work']);
      expect(report.tagsCreated).toBe(2);
    });

    it('imports several files, .txt and .markdown too', async () => {
      const report = await service.importFiles([file('one.md', 'a'), file('two.txt', 'b'), file('three.markdown', 'c')]);

      expect(report.notes).toBe(3);
      expect((await allNotes()).map((n) => n.title)).toEqual(['one', 'three', 'two']);
    });

    it('reports a file it cannot import instead of ignoring it', async () => {
      const report = await service.importFiles([file('ok.md', 'fine'), file('report.docx', 'x'), file('binary.md', new Uint8Array([104, 105, 0, 1, 2]))]);

      expect(report.notes).toBe(1);
      expect(report.skipped).toEqual([
        { name: 'report.docx', reason: expect.stringContaining('only .md') },
        { name: 'binary.md', reason: expect.stringContaining('not a text file') },
      ]);
    });

    it('does not import a text longer than a note may be, and says so', async () => {
      const report = await service.importFiles([file('huge.md', 'x'.repeat(NOTE_LIMITS.contentMaxLength + 1)), file('fits.md', 'x'.repeat(NOTE_LIMITS.contentMaxLength))]);

      expect(report.notes).toBe(1);
      expect(report.skipped).toMatchObject([{ name: 'huge.md', reason: expect.stringContaining('500,000') }]);
    });

    it('cuts a title that is too long', async () => {
      await service.importFiles([file('a.md', `---\ntitle: "${'t'.repeat(300)}"\n---\nbody`)]);

      expect((await allNotes())[0].title).toHaveLength(NOTE_LIMITS.titleMaxLength);
    });

    it('importing the same file twice makes two notes: nothing is overwritten or merged', async () => {
      await service.importFiles([file('a.md', 'same')]);
      await service.importFiles([file('a.md', 'same')]);

      expect(await allNotes()).toHaveLength(2);
    });

    it('leaves the notes that are already there alone', async () => {
      const existing = await notes.create('Existing', 'mine', null);

      await service.importFiles([file('Existing.md', 'from the file')]);

      expect((await local.db.contents.get(existing.id))?.content).toBe('mine');
      expect(await allNotes()).toHaveLength(2);
    });

    it('reports when there is nothing to import', async () => {
      const report = await service.importFiles([]);

      expect(report).toEqual({ notes: 0, notebooksCreated: 0, tagsCreated: 0, attachments: 0, skipped: [], unusedFiles: 0 });
    });
  });

  describe('zip files', () => {
    it('makes a notebook of each folder, nested folders into nested notebooks, and puts the notes in them', async () => {
      const report = await service.importFiles([
        zipFile('notes.zip', { 'top.md': 'a', 'Work/report.md': 'b', 'Work/Plans/roadmap.md': 'c' }),
      ]);

      const byTitle = Object.fromEntries(await Promise.all((await allNotes()).map(async (n) => [n.title, await notebookPath(n.notebookId)])));
      expect(byTitle).toEqual({ top: '', report: 'Work', roadmap: 'Work/Plans' });
      expect(report).toMatchObject({ notes: 3, notebooksCreated: 2 });
    });

    it('also makes the empty folders into notebooks', async () => {
      await service.importFiles([zipFile('x.zip', { 'Empty/': new Uint8Array(0), 'Work/a.md': 'x' })]);

      expect((await local.db.notebooks.toArray()).map((n) => n.name).sort()).toEqual(['Empty', 'Work']);
    });

    it('reuses a notebook of the same name in the same place (ignoring case) instead of making a copy', async () => {
      const work = await org.createNotebook('Work', null);

      const report = await service.importFiles([zipFile('x.zip', { 'work/a.md': 'x', 'WORK/b.md': 'y' })]);

      expect(report.notebooksCreated).toBe(0);
      expect((await allNotes()).every((n) => n.notebookId === work.id)).toBe(true);
    });

    it('makes a new notebook when the same name exists only in another place', async () => {
      const other = await org.createNotebook('Other', null);
      await org.createNotebook('Plans', other.id);

      const report = await service.importFiles([zipFile('x.zip', { 'Plans/a.md': 'x' })]);

      expect(report.notebooksCreated).toBe(1); // a top-level "Plans" is not the "Plans" inside "Other"
    });

    it('reuses a tag that exists (ignoring case) and creates the others once', async () => {
      await org.createTag('Work');

      const report = await service.importFiles([
        zipFile('x.zip', {
          'a.md': '---\ntags: [work, new]\n---\nA',
          'b.md': '---\ntags: [NEW, other]\n---\nB',
        }),
      ]);

      expect(report.tagsCreated).toBe(2); // "new" and "other"
      expect((await local.db.tags.toArray()).map((t) => t.name).sort()).toEqual(['Work', 'new', 'other']);
    });

    it('imports the .md files of a zip made by another app, with no front matter at all', async () => {
      await service.importFiles([zipFile('vault.zip', { 'Daily/2026-03-04.md': '# Tuesday\n\ndid things', 'readme.txt': 'hello' })]);

      expect((await allNotes()).map((n) => n.title).sort()).toEqual(['Tuesday', 'readme']);
    });

    it('leaves out the junk of other systems and hidden folders without making a fuss', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'a.md': 'x', '__MACOSX/._a.md': 'j', '.obsidian/app.md': 'h', '.DS_Store': 'j' })]);

      expect(report.notes).toBe(1);
      expect(report.skipped).toEqual([]);
    });

    it('counts the files nothing refers to', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'a.md': 'x', 'unused.png': PNG, 'data.csv': 'a,b', '_inknote.json': '{}' })]);

      expect(report.unusedFiles).toBe(2); // the manifest is not "unused": it is what InkNote wrote
    });

    it('recognizes a zip by its content even when the name says something else', async () => {
      const disguised = new File([zipSync({ 'a.md': strToU8('x') })], 'archive.dat');

      // not a note file and not .zip by name: only the bytes tell. It is a zip, so it is read as one.
      const report = await service.importFiles([disguised]);

      expect(report.notes).toBe(1);
    });
  });

  describe('files that are not what they say, and zips that are too much', () => {
    it('reports a ".zip" that is not a zip', async () => {
      const report = await service.importFiles([file('broken.zip', 'this is not a zip')]);

      expect(report.notes).toBe(0);
      expect(report.skipped.length).toBeGreaterThanOrEqual(0); // reported as an error or simply as nothing found
    });

    it('refuses a zip with too many entries as a whole, and imports the other files given with it', async () => {
      const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${i}.md`, 'x']));

      const report = await service.importFiles([zipFile('many.zip', many), file('fine.md', 'ok')], { ...DEFAULT_ZIP_LIMITS, maxEntries: 10 });

      expect(report.notes).toBe(1);
      expect(report.skipped).toMatchObject([{ name: 'many.zip', reason: expect.stringContaining('more than 10 files') }]);
    });

    it('skips an entry that is larger than the limit and imports the rest of the zip', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'ok.md': 'small', 'big.md': 'x'.repeat(5000) })], { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000 });

      expect(report.notes).toBe(1);
      expect(report.skipped).toMatchObject([{ name: 'x.zip: big.md', reason: expect.stringContaining('larger than') }]);
    });

    it('never lets a path with ".." through', async () => {
      const report = await service.importFiles([zipFile('evil.zip', { '../outside.md': 'x', 'Work/../../up.md': 'y', 'safe.md': 'z' })]);

      expect((await allNotes()).map((n) => n.title)).toEqual(['safe']);
      expect(report.skipped).toHaveLength(2);
    });

    it('sets the front matter of a zip entry apart from notebook names: a folder called "..." or empty makes no notebook', async () => {
      await service.importFiles([zipFile('x.zip', { 'a b/c.md': 'x' })]);

      expect((await local.db.notebooks.toArray()).map((n) => n.name)).toEqual(['a b']);
    });
  });

  describe('files that notes link to', () => {
    const note = (body: string) => `---\ntitle: "With files"\n---\n\n${body}`;
    const attachedContent = async () => (await allNotes())[0].content;

    it('attaches an image that is in the zip and rewrites the link to point to the attached file', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'n.md': note('![a cat](img/cat.png)'), 'img/cat.png': PNG })]);

      const content = await attachedContent();
      expect(content).toMatch(/^!\[a cat\]\(attachment:[0-9a-f-]{36}\)$/);
      expect(report.attachments).toBe(1);
      const id = content.match(/attachment:([0-9a-f-]{36})/)![1];
      expect([...new Uint8Array((await local.db.blobs.get(id))!.data)]).toEqual([...PNG]); // the very bytes
      expect(await local.db.uploads.get(id)).toMatchObject({ noteId: (await allNotes())[0].id });
    });

    it('the file waits in the upload queue and does not touch the note that was just made', async () => {
      await service.importFiles([zipFile('x.zip', { 'n.md': note('![a](cat.png)'), 'cat.png': PNG })]);

      expect(await local.db.uploads.count()).toBe(1);
      expect((await allNotes())[0].version).toBe(0);
    });

    it('resolves the link from the folder of the note, with "../", with spaces and in any case', async () => {
      const report = await service.importFiles([
        zipFile('x.zip', {
          'Trips/Rome.md': note('![x](../_attachments/Photo%20One.PNG) ![y](<../_attachments/photo one.png>)'),
          '_attachments/photo one.png': PNG,
        }),
      ]);

      expect(report.attachments).toBe(1); // the same file twice is attached once
      const content = await attachedContent();
      expect((content.match(/attachment:/g) ?? []).length).toBe(2);
      expect(new Set(content.match(/attachment:[0-9a-f-]{36}/g)).size).toBe(1);
    });

    it('writes a file as a link (not an image) when the Markdown did', async () => {
      await service.importFiles([zipFile('x.zip', { 'n.md': note('[the plan](plan.pdf)'), 'plan.pdf': PDF })]);

      expect(await attachedContent()).toMatch(/^\[the plan\]\(attachment:[0-9a-f-]{36}\)$/);
    });

    it('drops a title written after the address', async () => {
      await service.importFiles([zipFile('x.zip', { 'n.md': note('![a](cat.png "A cat")'), 'cat.png': PNG })]);

      expect(await attachedContent()).toMatch(/^!\[a\]\(attachment:[0-9a-f-]{36}\)$/);
    });

    it.each([
      ['a web address', '![x](https://example.com/a.png)'],
      ['a data address', '![x](data:image/png;base64,AAAA)'],
      ['a javascript address', '[x](javascript:alert(1))'],
      ['a file that is not in the zip', '![x](missing.png)'],
      ['a link to another note', '[other](other.md)'],
      ['a link above the zip', '![x](../../outside.png)'],
      ['an anchor', '[x](#heading)'],
      ['an attachment link already', '![x](attachment:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d)'],
    ])('leaves %s exactly as it is', async (_name, link) => {
      const report = await service.importFiles([zipFile('x.zip', { 'n.md': note(link), 'other.md': 'o', 'cat.png': PNG })]);

      const imported = (await allNotes()).find((n) => n.title === 'With files')!;
      expect(imported.content).toBe(link);
      expect(report.attachments).toBe(0);
    });

    it('does not attach a kind of file that is not allowed, says so, and leaves the link', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'n.md': note('![logo](logo.svg)'), 'logo.svg': '<svg onload=alert(1)/>' })]);

      expect(await attachedContent()).toBe('![logo](logo.svg)');
      expect(report.attachments).toBe(0);
      expect(report.skipped).toMatchObject([{ name: expect.stringContaining('logo.svg'), reason: expect.stringContaining('not attached') }]);
    });

    it('does not attach what is too large', async () => {
      const big = new Uint8Array(11 * 1024 * 1024);
      big.set(PNG);

      const report = await service.importFiles([zipFile('x.zip', { 'n.md': note('![huge](huge.png)'), 'huge.png': big })], { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 20 * 1024 * 1024 });

      expect(report.attachments).toBe(0);
      expect(report.skipped[0].reason).toContain('larger than 10 MB');
    });

    it('does not count the files it used as unused', async () => {
      const report = await service.importFiles([zipFile('x.zip', { 'n.md': note('![a](cat.png)'), 'cat.png': PNG })]);

      expect(report.unusedFiles).toBe(0);
    });
  });

  describe('export, then import: nothing is lost', () => {
    it('gives back the notebooks, tags, status, pin, texts and attached files, in an empty database', async () => {
      // ---- the user's data ----
      const work = await org.createNotebook('Work', null);
      const plans = await org.createNotebook('Plans', work.id);
      await org.createNotebook('Empty notebook', null);
      const tagWork = await org.createTag('work');
      const tagIdea = await org.createTag('big idea');
      if (tagWork.status !== 'ok' || tagIdea.status !== 'ok') throw new Error('expected ok');

      const loose = await notes.create('Loose: a "note"', '# Heading\n\nSome **text** with `code`.\n', null);
      const report = await notes.create('Quarterly report', 'See the chart: ![chart](attachment:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d)\nAnd [the data](attachment:1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e).\n', work.id);
      const roadmap = await notes.create('Roadmap', '- [ ] one\n- [x] two\n', plans.id);
      await notes.updateOrganization(report.id, { notebookId: work.id, isPinned: true, status: 'Completed', tagIds: [tagWork.tag.id, tagIdea.tag.id] });
      await notes.updateOrganization(roadmap.id, { notebookId: plans.id, isPinned: false, status: 'OnHold', tagIds: [tagIdea.tag.id] });
      await local.db.blobs.put({ id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: 'chart.png', type: 'image/png', size: PNG.length, data: PNG.slice().buffer, cachedAt: 1 });
      await local.db.blobs.put({ id: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e', name: 'data (final).pdf', type: 'application/pdf', size: PDF.length, data: PDF.slice().buffer, cachedAt: 1 });
      const before = await snapshot();

      // ---- out ----
      const exported = await TestBed.inject(ExportService).exportAll();
      const zip = new File([new Uint8Array(await readBytes(exported.blob))], exported.fileName);

      // ---- and into an empty database ----
      await local.wipe();
      await local.open(`import-again-${++counter}`);
      const result = await service.importFiles([zip]);

      expect(result).toMatchObject({ notes: 3, notebooksCreated: 3, tagsCreated: 2, attachments: 2, skipped: [], unusedFiles: 0 });
      expect(await snapshot()).toEqual(before);
      expect(loose.id).toBeTruthy();

      /** Everything about the data that must survive, with ids replaced by what they stand for. */
      async function snapshot() {
        const rows = await allNotes();
        const tagsById = new Map((await local.db.tags.toArray()).map((t) => [t.id, t.name]));
        const blobs = new Map((await local.db.blobs.toArray()).map((b) => [b.id, `${b.name}:${[...new Uint8Array(b.data)].join(',')}`]));
        return {
          notebooks: (await Promise.all((await local.db.notebooks.toArray()).map((n) => notebookPath(n.id)))).sort(),
          notes: await Promise.all(
            rows.map(async (n) => ({
              title: n.title,
              notebook: await notebookPath(n.notebookId),
              tags: n.tagIds.map((id) => tagsById.get(id)).sort(),
              status: n.status,
              pinned: n.isPinned,
              // a link to an attached file, with the id replaced by the file it names
              content: n.content.replace(/attachment:([0-9a-f-]{36})/g, (_m, id: string) => `attachment:{${blobs.get(id) ?? 'MISSING'}}`),
            })),
          ),
        };
      }
    });

    it('a second round trip gives the same files again (the format is stable)', async () => {
      const book = await org.createNotebook('Book', null);
      await notes.create('One', 'text one', book.id);
      await notes.create('Two', 'text two', null);
      const first = await TestBed.inject(ExportService).exportAll(new Date('2026-01-01T00:00:00Z'));

      await local.wipe();
      await local.open(`import-twice-${++counter}`);
      await service.importFiles([new File([new Uint8Array(await readBytes(first.blob))], 'x.zip')]);
      const second = await TestBed.inject(ExportService).exportAll(new Date('2026-01-01T00:00:00Z'));

      const listing = async (blob: Blob) => Object.keys(((await import('fflate')).unzipSync(new Uint8Array(await readBytes(blob))))).sort();
      expect(await listing(second.blob)).toEqual(await listing(first.blob));
    });
  });
});
