import { TestBed } from '@angular/core/testing';
import { LocalDbService, OutboxOp } from '../../sync/local/local-db';
import { NotesRepository } from '../data/notes-repository';
import { OrganizationStore } from './organization.store';

let counter = 0;

describe('OrganizationStore (notebooks and tags on this device)', () => {
  let store: InstanceType<typeof OrganizationStore>;
  let local: LocalDbService;

  beforeEach(async () => {
    local = TestBed.inject(LocalDbService);
    store = TestBed.inject(OrganizationStore);
    await local.open(`org-store-${++counter}`);
  });

  afterEach(() => local.wipe());

  const ops = (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray();

  it('load answers true once notebooks and tags are in, and keeps following the database', async () => {
    await local.db.notebooks.put({ id: 'nb1', name: 'Work', parentId: null, version: 1 });
    await local.db.tags.bulkPut([
      { id: 't2', name: 'zebra', version: 1 },
      { id: 't1', name: 'alpha', version: 1 },
    ]);

    expect(await store.load()).toBe(true);

    expect(store.notebooks().map((n) => n.name)).toEqual(['Work']);
    expect(store.tags().map((t) => t.name)).toEqual(['alpha', 'zebra']); // sorted by name
    expect(store.loading()).toBe(false);

    await local.db.tags.put({ id: 't3', name: 'middle', version: 1 }); // e.g. pulled from the server
    await vi.waitFor(() => expect(store.tags().map((t) => t.name)).toEqual(['alpha', 'middle', 'zebra']));
  });

  it('builds the tree and the flat options from the notebooks', async () => {
    await local.db.notebooks.bulkPut([
      { id: 'a', name: 'Parent', parentId: null, version: 1 },
      { id: 'b', name: 'Child', parentId: 'a', version: 1 },
    ]);
    await store.load();

    expect(store.tree().map((n) => n.notebook.name)).toEqual(['Parent']);
    expect(store.notebookOptions().map((o) => o.path)).toEqual(['Parent', 'Parent / Child']);
  });

  it('createNotebook works at once, offline, and queues it', async () => {
    await store.load();

    const notebook = await store.createNotebook('Ideas', null);

    expect(notebook).toMatchObject({ name: 'Ideas', parentId: null });
    await vi.waitFor(() => expect(store.notebooks().map((n) => n.name)).toEqual(['Ideas']));
    expect((await ops())[0]).toMatchObject({ entity: 'notebook', kind: 'upsert', data: { name: 'Ideas', parentId: null } });
  });

  it('renameNotebook changes the name and says not-found for a missing one', async () => {
    await store.load();
    const notebook = (await store.createNotebook('Old', null))!;

    expect(await store.renameNotebook(notebook.id, 'New')).toBe('ok');
    expect(await store.renameNotebook('missing', 'x')).toBe('not-found');

    await vi.waitFor(() => expect(store.notebooks()[0].name).toBe('New'));
  });

  it('deleteNotebook refuses a notebook that is not empty, deletes an empty one, and treats a missing one as done', async () => {
    await store.load();
    const parent = (await store.createNotebook('Parent', null))!;
    await store.createNotebook('Child', parent.id);
    const loose = (await store.createNotebook('Empty', null))!;
    const notes = TestBed.inject(NotesRepository);
    await notes.create('Inside', '', loose.id);

    expect(await store.deleteNotebook(parent.id)).toBe('not-empty'); // has a sub-notebook
    expect(await store.deleteNotebook(loose.id)).toBe('not-empty'); // has a note
    expect(await store.deleteNotebook('missing')).toBe('ok');
    await vi.waitFor(() => expect(store.notebooks()).toHaveLength(3));
  });

  it('createTag refuses a name that exists (ignoring case) and creates a new one', async () => {
    await store.load();

    const first = await store.createTag('Work');
    const clash = await store.createTag('work');

    expect(first.status).toBe('ok');
    expect(clash.status).toBe('duplicate');
    await vi.waitFor(() => expect(store.tags().map((t) => t.name)).toEqual(['Work']));
  });

  it('deleteTag removes the tag and takes it off the notes', async () => {
    await store.load();
    const tag = await store.createTag('Temp');
    if (tag.status !== 'ok') throw new Error('expected ok');
    const notes = TestBed.inject(NotesRepository);
    const note = await notes.create('T', 'b', null);
    await notes.updateOrganization(note.id, { notebookId: null, isPinned: false, status: 'None', tagIds: [tag.tag.id] });

    expect(await store.deleteTag(tag.tag.id)).toBe(true);

    await vi.waitFor(() => expect(store.tags()).toEqual([]));
    expect((await notes.get(note.id))?.tagIds).toEqual([]);
  });
});
