import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { strFromU8, unzipSync } from 'fflate';
import { readBytes } from '../attachments/data/attachment-repository';
import { NotesRepository } from '../notes/data/notes-repository';
import { OrganizationRepository } from '../notes/data/organization-repository';
import { LocalDbService } from '../sync/local/local-db';
import { ExportService, MANIFEST_FILE, notebookFolders, notebookWithDescendants } from './export.service';
import { ImportService } from './import.service';
import { parseNoteFile } from './note-file';

let counter = 0;
const ID_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ID_B = '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e';

describe('ExportService', () => {
  let service: ExportService;
  let local: LocalDbService;
  let notes: NotesRepository;
  let org: OrganizationRepository;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ExportService);
    local = TestBed.inject(LocalDbService);
    notes = TestBed.inject(NotesRepository);
    org = TestBed.inject(OrganizationRepository);
    http = TestBed.inject(HttpTestingController);
    await local.open(`export-${++counter}`);
  });

  afterEach(async () => {
    http.verify();
    await local.wipe();
  });

  const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await readBytes(blob)));
  const names = (zip: Record<string, Uint8Array>) => Object.keys(zip).filter((n) => n !== MANIFEST_FILE).sort();
  const text = (zip: Record<string, Uint8Array>, path: string) => strFromU8(zip[path]);
  const storeFile = (id: string, name: string, type: string, bytes: number[]) =>
    local.db.blobs.put({ id, name, type, size: bytes.length, data: new Uint8Array(bytes).buffer, cachedAt: 1 });

  describe('all notes', () => {
    it('puts each note in a Markdown file in the folder of its notebook, and loose notes at the top', async () => {
      const work = await org.createNotebook('Work', null);
      const plans = await org.createNotebook('Plans', work.id);
      await notes.create('Loose note', 'on its own', null);
      await notes.create('Report', 'in work', work.id);
      await notes.create('Roadmap', 'in plans', plans.id);

      const { blob, notes: count } = await service.exportAll();
      const zip = await unzip(blob);

      expect(count).toBe(3);
      expect(names(zip)).toEqual(['Loose note.md', 'Work/', 'Work/Plans/', 'Work/Plans/Roadmap.md', 'Work/Report.md']);
    });

    it('writes title, tags, status and pin in the front matter, and the text as it is', async () => {
      const tagWork = await org.createTag('work');
      const tagIdea = await org.createTag('big idea');
      if (tagWork.status !== 'ok' || tagIdea.status !== 'ok') throw new Error('expected ok');
      const note = await notes.create('Plan: v2', '# Heading\n\nText with "quotes".\n', null);
      await notes.updateOrganization(note.id, { notebookId: null, isPinned: true, status: 'Active', tagIds: [tagWork.tag.id, tagIdea.tag.id] });

      const zip = await unzip((await service.exportAll()).blob);

      const parsed = parseNoteFile(text(zip, 'Plan_ v2.md'), 'Plan_ v2.md');
      expect(parsed).toEqual({ title: 'Plan: v2', content: '# Heading\n\nText with "quotes".\n', tags: ['work', 'big idea'], status: 'Active', pinned: true });
    });

    it('keeps the empty notebooks as folders', async () => {
      await org.createNotebook('Empty one', null);

      const zip = await unzip((await service.exportAll()).blob);

      expect(names(zip)).toEqual(['Empty one/']);
    });

    it('does not lose notes that have the same title: they are numbered', async () => {
      await notes.create('Same', 'first', null);
      await notes.create('Same', 'second', null);
      await notes.create('same', 'third', null);

      const zip = await unzip((await service.exportAll()).blob);

      expect(names(zip)).toHaveLength(3);
      expect(names(zip).filter((n) => /^same( \(\d\))?\.md$/i.test(n))).toHaveLength(3);
      expect(names(zip).map((n) => text(zip, n).split('\n\n').pop()).sort()).toEqual(['first', 'second', 'third']);
    });

    it('makes titles safe as file names without changing the title inside the file', async () => {
      await notes.create('What? Why: now / then', 'x', null);
      await notes.create('CON', 'y', null);
      await notes.create('...', 'z', null);

      const zip = await unzip((await service.exportAll()).blob);

      expect(names(zip)).toEqual(['CON_.md', 'Untitled.md', 'What_ Why_ now _ then.md']);
      expect(parseNoteFile(text(zip, 'What_ Why_ now _ then.md'), 'f.md').title).toBe('What? Why: now / then');
    });

    it('includes a manifest that says what the zip is', async () => {
      await notes.create('A', 'x', null);

      const zip = await unzip((await service.exportAll(new Date('2026-03-04T10:00:00Z'))).blob);

      expect(JSON.parse(text(zip, MANIFEST_FILE))).toEqual({ format: 'inknote-export', version: 1, exportedAt: '2026-03-04T10:00:00.000Z', notes: 1 });
    });

    it('names the file after the day', async () => {
      const result = await service.exportAll(new Date('2026-03-04T10:00:00Z'));

      expect(result.fileName).toBe('inknote-export-2026-03-04.zip');
      expect(result.blob.type).toBe('application/zip');
    });

    it('exports nothing but the manifest when there are no notes', async () => {
      const result = await service.exportAll();

      expect(result.notes).toBe(0);
      expect(names(await unzip(result.blob))).toEqual([]);
    });
  });

  describe('one notebook', () => {
    it('is a zip with the notebook as its top folder, its sub-notebooks and their notes, and nothing else', async () => {
      const work = await org.createNotebook('Work', null);
      const plans = await org.createNotebook('Plans', work.id);
      const other = await org.createNotebook('Other', null);
      await notes.create('Loose', 'x', null);
      await notes.create('Report', 'in work', work.id);
      await notes.create('Roadmap', 'in plans', plans.id);
      await notes.create('Elsewhere', 'in other', other.id);

      const result = await service.exportNotebook(work.id);
      const zip = await unzip(result!.blob);

      expect(result!.notes).toBe(2);
      expect(result!.fileName).toBe('Work.zip');
      expect(names(zip)).toEqual(['Work/', 'Work/Plans/', 'Work/Plans/Roadmap.md', 'Work/Report.md']);
    });

    it('starts at the chosen notebook even when it sits deep in the tree: its parents are not in the zip', async () => {
      const a = await org.createNotebook('A', null);
      const b = await org.createNotebook('B', a.id);
      await notes.create('Deep', 'x', b.id);

      const zip = await unzip((await service.exportNotebook(b.id))!.blob);

      expect(names(zip)).toEqual(['B/', 'B/Deep.md']);
    });

    it('keeps an empty notebook as a folder, and the tags and status of its notes', async () => {
      const book = await org.createNotebook('Book', null);
      const tag = await org.createTag('t');
      if (tag.status !== 'ok') throw new Error('expected ok');
      const note = await notes.create('N', 'x', book.id);
      await notes.updateOrganization(note.id, { notebookId: book.id, isPinned: false, status: 'Active', tagIds: [tag.tag.id] });
      await org.createNotebook('Empty', book.id);

      const zip = await unzip((await service.exportNotebook(book.id))!.blob);

      expect(names(zip)).toEqual(['Book/', 'Book/Empty/', 'Book/N.md']);
      expect(parseNoteFile(text(zip, 'Book/N.md'), 'N.md')).toMatchObject({ tags: ['t'], status: 'Active' });
    });

    it('is null for a notebook that does not exist', async () => {
      expect(await service.exportNotebook(ID_A)).toBeNull();
    });

    it('imports back as the same notebook, wherever it is imported', async () => {
      const book = await org.createNotebook('Book', null);
      await org.createNotebook('Sub', book.id);
      await notes.create('N', 'text', book.id);
      const result = (await service.exportNotebook(book.id))!;
      const target = await org.createNotebook('Elsewhere', null);

      const importer = TestBed.inject(ImportService);
      await importer.importFiles([new File([result.blob], result.fileName)], undefined, target.id);

      const all = await local.db.notebooks.toArray();
      const imported = all.find((n) => n.name === 'Book' && n.parentId === target.id);
      expect(imported).toBeTruthy();
      expect(all.some((n) => n.name === 'Sub' && n.parentId === imported!.id)).toBe(true);
    });
  });

  describe('attached files', () => {
    it('adds the file to _attachments and writes the link as a relative path from the folder of the note', async () => {
      const book = await org.createNotebook('Trips', null);
      const note = await notes.create('Rome', `Look: ![the colosseum](attachment:${ID_A}) and [the plan](attachment:${ID_B})`, book.id);
      await storeFile(ID_A, 'colosseum.png', 'image/png', [1, 2, 3]);
      await storeFile(ID_B, 'plan (final).pdf', 'application/pdf', [4, 5]);

      const result = await service.exportAll();
      const zip = await unzip(result.blob);

      expect(result.attachments).toBe(2);
      expect(result.missingAttachments).toBe(0);
      expect(names(zip)).toEqual(['Trips/', 'Trips/Rome.md', '_attachments/0a1b2c3d/colosseum.png', '_attachments/1a1b2c3d/plan (final).pdf']);
      const body = parseNoteFile(text(zip, 'Trips/Rome.md'), 'x.md').content;
      expect(body).toBe('Look: ![the colosseum](../_attachments/0a1b2c3d/colosseum.png) and [the plan](../_attachments/1a1b2c3d/plan%20%28final%29.pdf)');
      expect([...zip['_attachments/0a1b2c3d/colosseum.png']]).toEqual([1, 2, 3]); // the very bytes
      expect(note.id).toBeTruthy();
    });

    it('a note at the top links without "../"', async () => {
      await notes.create('Top', `![x](attachment:${ID_A})`, null);
      await storeFile(ID_A, 'x.png', 'image/png', [1]);

      const zip = await unzip((await service.exportAll()).blob);

      expect(parseNoteFile(text(zip, 'Top.md'), 'x.md').content).toBe('![x](_attachments/0a1b2c3d/x.png)');
    });

    it('stores a file once however often notes refer to it', async () => {
      await notes.create('One', `![a](attachment:${ID_A})`, null);
      await notes.create('Two', `![b](attachment:${ID_A}) ![c](attachment:${ID_A})`, null);
      await storeFile(ID_A, 'x.png', 'image/png', [1]);

      const result = await service.exportAll();

      expect(result.attachments).toBe(1);
      expect(names(await unzip(result.blob)).filter((n) => n.startsWith('_attachments/'))).toHaveLength(1);
    });

    it('leaves the link as it is, and counts the file, when it is not on this device and the server cannot be asked', async () => {
      await notes.create('Missing', `![gone](attachment:${ID_A})`, null);

      const done = service.exportAll();
      await vi.waitFor(() => http.expectOne((r) => r.url.endsWith(`/api/attachments/${ID_A}/url`)).error(new ProgressEvent('error')));
      const result = await done;

      expect(result.attachments).toBe(0);
      expect(result.missingAttachments).toBe(1);
      expect(parseNoteFile(text(await unzip(result.blob), 'Missing.md'), 'x.md').content).toBe(`![gone](attachment:${ID_A})`);
    });

    it('asks the server only once for a file that is missing, even when it is used twice', async () => {
      await notes.create('Twice', `![a](attachment:${ID_A}) ![b](attachment:${ID_A})`, null);

      const done = service.exportAll();
      await vi.waitFor(() => http.expectOne((r) => r.url.endsWith(`/api/attachments/${ID_A}/url`)).error(new ProgressEvent('error')));
      const result = await done;

      expect(result.missingAttachments).toBe(1);
    });

    it('does not turn other text into links: only the exact attachment form', async () => {
      await notes.create('Plain', 'attachment:not-an-id and (attachment:0a1b2c3d)', null);

      const result = await service.exportAll();

      expect(parseNoteFile(text(await unzip(result.blob), 'Plain.md'), 'x.md').content).toBe('attachment:not-an-id and (attachment:0a1b2c3d)');
    });
  });

  describe('one note', () => {
    it('is a plain .md file when it has no attached files', async () => {
      const note = await notes.create('Solo: note', 'just text', null);

      const result = (await service.exportNote(note.id))!;

      expect(result.fileName).toBe('Solo_ note.md');
      expect(result.blob.type).toBe('text/markdown');
      expect(parseNoteFile(await blobText(result.blob), 'x.md')).toMatchObject({ title: 'Solo: note', content: 'just text' });
    });

    it('is a zip, with the files next to it, when it has attached files', async () => {
      const book = await org.createNotebook('Deep', null);
      const note = await notes.create('With picture', `![p](attachment:${ID_A})`, book.id);
      await storeFile(ID_A, 'p.png', 'image/png', [9]);

      const result = (await service.exportNote(note.id))!;
      const zip = await unzip(result.blob);

      expect(result.fileName).toBe('With picture.zip');
      expect(names(zip)).toEqual(['With picture.md', '_attachments/0a1b2c3d/p.png']); // no notebook folder for a single note
      expect(parseNoteFile(text(zip, 'With picture.md'), 'x.md').content).toBe('![p](_attachments/0a1b2c3d/p.png)');
    });

    it('is null for a note that does not exist', async () => {
      expect(await service.exportNote('missing')).toBeNull();
    });
  });
});

describe('notebookWithDescendants', () => {
  it('gives the notebook and everything below it, and nothing else', () => {
    const tree = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: null },
    ];

    expect([...notebookWithDescendants('a', tree)].sort()).toEqual(['a', 'b', 'c']);
    expect([...notebookWithDescendants('c', tree)]).toEqual(['c']);
  });

  it('does not loop on a cycle in the data', () => {
    const cycle = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];

    expect([...notebookWithDescendants('a', cycle)].sort()).toEqual(['a', 'b']);
  });
});

describe('notebookFolders', () => {
  const folders = (list: { id: string; name: string; parentId: string | null }[]) => Object.fromEntries(notebookFolders(list));

  it('builds the path of each notebook from its parents', () => {
    expect(folders([{ id: 'a', name: 'Work', parentId: null }, { id: 'b', name: 'Plans', parentId: 'a' }, { id: 'c', name: '2026', parentId: 'b' }])).toEqual({
      a: ['Work'],
      b: ['Work', 'Plans'],
      c: ['Work', 'Plans', '2026'],
    });
  });

  it('numbers two notebooks with the same name in the same place, and not the same name in different places', () => {
    const result = folders([
      { id: 'a', name: 'Notes', parentId: null },
      { id: 'b', name: 'notes', parentId: null },
      { id: 'p', name: 'Parent', parentId: null },
      { id: 'c', name: 'Notes', parentId: 'p' },
    ]);

    expect(new Set([result['a'][0], result['b'][0]]).size).toBe(2);
    expect(result['c']).toEqual(['Parent', 'Notes']);
  });

  it('makes names safe', () => {
    expect(folders([{ id: 'a', name: 'Work / 2026: plans?', parentId: null }])['a']).toEqual(['Work _ 2026_ plans_']);
  });

  it('puts a notebook whose parent is missing, or that is part of a cycle, at the top', () => {
    const result = folders([
      { id: 'orphan', name: 'Orphan', parentId: 'gone' },
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
    ]);

    expect(result['orphan']).toEqual(['Orphan']);
    expect(Object.keys(result).sort()).toEqual(['orphan', 'x', 'y']); // and it terminates
    expect(result['x'].length + result['y'].length).toBeLessThanOrEqual(3);
  });
});

function blobText(blob: Blob): Promise<string> {
  return readBytes(blob).then((bytes) => new TextDecoder().decode(bytes));
}
