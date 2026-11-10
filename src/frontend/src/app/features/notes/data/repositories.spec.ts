import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { LocalDbService, OutboxOp } from '../../sync/local/local-db';
import { NotesRepository } from './notes-repository';
import { OrganizationRepository } from './organization-repository';

let counter = 0;

/** Subscribes and keeps everything the observable emits. */
function collect<T>(source: Observable<T>) {
  const values: T[] = [];
  const subscription = source.subscribe((value) => values.push(value));
  return { values, stop: () => subscription.unsubscribe() };
}

describe('the local repositories', () => {
  let local: LocalDbService;
  let notes: NotesRepository;
  let org: OrganizationRepository;

  beforeEach(async () => {
    local = TestBed.inject(LocalDbService);
    notes = TestBed.inject(NotesRepository);
    org = TestBed.inject(OrganizationRepository);
    await local.open(`repo-${++counter}`);
  });

  afterEach(() => local.wipe());

  const ops = (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray();
  /** Pretends the server accepted everything: the note is "synchronized" at this version and the queue is empty. */
  const markSynced = async (id: string, version: number) => {
    await local.db.notes.update(id, { version });
    await local.db.outbox.clear();
  };

  describe('notes', () => {
    it('creates a note on this device, with an id of its own, and queues the creation', async () => {
      const note = await notes.create('Hello', 'text', null);

      expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(note).toMatchObject({ title: 'Hello', content: 'text', version: 0, notebookId: null, isPinned: false, status: 'None', tagIds: [] });
      expect(await notes.get(note.id)).toEqual(note);
      const [op] = await ops();
      expect(op).toMatchObject({ entity: 'note', id: note.id, kind: 'upsert', baseVersion: null, data: { title: 'Hello', content: 'text', notebookId: null } });
    });

    it('creating a note and typing in it before it was ever sent is still ONE queued operation', async () => {
      const note = await notes.create('Untitled', '', null);

      await notes.saveText(note.id, 'Real title', 'first');
      await notes.saveText(note.id, 'Real title', 'first, then more');

      const all = await ops();
      expect(all).toHaveLength(1);
      expect(all[0].data).toEqual({ title: 'Real title', content: 'first, then more', notebookId: null });
    });

    it('saves only what changed and sends the base version', async () => {
      const note = await notes.create('T', 'body', null);
      await markSynced(note.id, 4);

      await notes.saveText(note.id, 'T', 'new body'); // the title did not change

      const [op] = await ops();
      expect(op.data).toEqual({ content: 'new body' });
      expect(op.baseVersion).toBe(4);
      expect((await notes.get(note.id))?.content).toBe('new body'); // and the local copy is already up to date
    });

    it('saving identical text queues nothing', async () => {
      const note = await notes.create('T', 'body', null);
      await markSynced(note.id, 1);

      expect(await notes.saveText(note.id, 'T', 'body')).toBe(true);

      expect(await ops()).toEqual([]);
    });

    it('queues only the organization fields that changed', async () => {
      const note = await notes.create('T', 'b', null);
      await markSynced(note.id, 2);

      await notes.updateOrganization(note.id, { notebookId: null, isPinned: true, status: 'Active', tagIds: [] });

      const [op] = await ops();
      expect(op.data).toEqual({ isPinned: true, status: 'Active' });
      const row = await notes.get(note.id);
      expect(row).toMatchObject({ isPinned: true, status: 'Active' });
    });

    it('treats the same tags in another order as unchanged', async () => {
      const note = await notes.create('T', 'b', null);
      await notes.updateOrganization(note.id, { notebookId: null, isPinned: false, status: 'None', tagIds: ['a', 'b'] });
      await markSynced(note.id, 1);

      await notes.updateOrganization(note.id, { notebookId: null, isPinned: false, status: 'None', tagIds: ['b', 'a'] });

      expect(await ops()).toEqual([]);
    });

    it('an edit of the text and an edit of the organization of the same note share one operation', async () => {
      const note = await notes.create('T', 'b', null);
      await markSynced(note.id, 2);

      await notes.saveText(note.id, 'T2', 'b');
      await notes.updateOrganization(note.id, { notebookId: 'nb', isPinned: false, status: 'None', tagIds: [] });

      const all = await ops();
      expect(all).toHaveLength(1);
      expect(all[0].data).toEqual({ title: 'T2', notebookId: 'nb' });
    });

    it('deleting removes the note and its text here and queues a delete', async () => {
      const note = await notes.create('T', 'b', null);
      await markSynced(note.id, 3);

      expect(await notes.delete(note.id)).toBe(true);

      expect(await notes.get(note.id)).toBeUndefined();
      expect(await local.db.contents.get(note.id)).toBeUndefined();
      expect((await ops())[0]).toMatchObject({ kind: 'delete', baseVersion: 3 });
    });

    it('deleting a note that never left this device queues nothing', async () => {
      const note = await notes.create('T', 'b', null);

      await notes.delete(note.id);

      expect(await ops()).toEqual([]);
    });

    it('returns false for a note that does not exist', async () => {
      expect(await notes.saveText('nope', 'x', 'y')).toBe(false);
      expect(await notes.updateOrganization('nope', { notebookId: null, isPinned: false, status: 'None', tagIds: [] })).toBe(false);
      expect(await notes.delete('nope')).toBe(false);
      expect(await notes.get('nope')).toBeUndefined();
    });

    it('a change that fails halfway leaves neither the row nor the queue changed (one transaction)', async () => {
      const note = await notes.create('T', 'body', null);
      await markSynced(note.id, 1);
      const failing = vi.spyOn(local.db.contents, 'put').mockRejectedValueOnce(new Error('disk full'));

      await expect(notes.saveText(note.id, 'Changed', 'changed body')).rejects.toThrow('disk full');
      failing.mockRestore();

      expect((await notes.get(note.id))?.title).toBe('T'); // the title update was rolled back too
      expect(await ops()).toEqual([]);
    });

    it('the list is live: it follows every change by itself, without text', async () => {
      const lists = collect(notes.watchSummaries());
      await vi.waitFor(() => expect(lists.values).toHaveLength(1)); // the first answer: nothing yet

      const note = await notes.create('One', 'text', null);
      await vi.waitFor(() => expect(lists.values.at(-1)?.map((n) => n.title)).toEqual(['One']));
      await notes.saveText(note.id, 'Two', 'text');

      await vi.waitFor(() => expect(lists.values.at(-1)?.map((n) => n.title)).toEqual(['Two']));
      expect(Object.keys(lists.values.at(-1)![0])).not.toContain('content'); // summaries never carry the text
      lists.stop();
    });

    it('watching one note emits again when it changes and undefined when it disappears', async () => {
      const note = await notes.create('One', 'a', null);
      const states = collect(notes.watch(note.id));
      await vi.waitFor(() => expect(states.values.at(-1)?.content).toBe('a'));

      await notes.saveText(note.id, 'One', 'b');
      await vi.waitFor(() => expect(states.values.at(-1)?.content).toBe('b'));
      await notes.delete(note.id);

      await vi.waitFor(() => expect(states.values.at(-1)).toBeUndefined());
      states.stop();
    });
  });

  describe('notebooks and tags', () => {
    it('creates, renames and deletes a notebook, queueing each step', async () => {
      const notebook = await org.createNotebook('Work', null);
      expect((await ops())[0]).toMatchObject({ entity: 'notebook', kind: 'upsert', data: { name: 'Work', parentId: null } });
      await local.db.notebooks.update(notebook.id, { version: 1 });
      await local.db.outbox.clear();

      expect(await org.renameNotebook(notebook.id, 'Jobs')).toBe(true);
      expect((await ops())[0].data).toEqual({ name: 'Jobs' });
      await local.db.outbox.clear();

      expect(await org.deleteNotebook(notebook.id)).toBe('ok');
      expect((await ops())[0]).toMatchObject({ kind: 'delete' });
    });

    it('refuses to delete a notebook that holds a note or a sub-notebook', async () => {
      const parent = await org.createNotebook('Parent', null);
      const child = await org.createNotebook('Child', parent.id);
      await notes.create('Inside', 'x', child.id);

      expect(await org.deleteNotebook(parent.id)).toBe('not-empty'); // has a sub-notebook
      expect(await org.deleteNotebook(child.id)).toBe('not-empty');  // has a note
      expect(await local.db.notebooks.count()).toBe(2);
      expect(await org.deleteNotebook('nope')).toBe('not-found');
    });

    it('creates a tag unless one with the same name exists, ignoring case and spaces', async () => {
      const first = await org.createTag('Work');
      const clash = await org.createTag('  work ');

      expect(first.status).toBe('ok');
      expect(clash).toEqual({ status: 'duplicate' });
      expect(await local.db.tags.count()).toBe(1);
      expect(await ops()).toHaveLength(1);
    });

    it('deleting a tag takes it off the notes here, without queueing anything for those notes', async () => {
      const tag = await org.createTag('Temp');
      if (tag.status !== 'ok') throw new Error('expected ok');
      const note = await notes.create('T', 'b', null);
      await notes.updateOrganization(note.id, { notebookId: null, isPinned: false, status: 'None', tagIds: [tag.tag.id, 'other'] });
      await local.db.tags.update(tag.tag.id, { version: 1 });
      await markSynced(note.id, 2);

      expect(await org.deleteTag(tag.tag.id)).toBe(true);

      expect((await notes.get(note.id))?.tagIds).toEqual(['other']);
      const all = await ops();
      expect(all).toHaveLength(1); // only the tag's deletion: the server removes the tag from its notes itself
      expect(all[0]).toMatchObject({ entity: 'tag', kind: 'delete' });
      expect(await org.deleteTag('nope')).toBe(false);
    });

    it('the lists are live', async () => {
      const tags = collect(org.watchTags());
      await vi.waitFor(() => expect(tags.values).toHaveLength(1));

      await org.createTag('Idea');

      await vi.waitFor(() => expect(tags.values.at(-1)?.map((t) => t.name)).toEqual(['Idea']));
      tags.stop();
    });
  });
});
