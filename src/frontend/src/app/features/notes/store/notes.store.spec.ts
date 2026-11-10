import { TestBed } from '@angular/core/testing';
import { LocalDbService, OutboxOp } from '../../sync/local/local-db';
import { NotesRepository } from '../data/notes-repository';
import { NotesStore } from './notes.store';

let counter = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('NotesStore (reads and writes the database of this device)', () => {
  let store: InstanceType<typeof NotesStore>;
  let repo: NotesRepository;
  let local: LocalDbService;

  beforeEach(async () => {
    local = TestBed.inject(LocalDbService);
    repo = TestBed.inject(NotesRepository);
    store = TestBed.inject(NotesStore);
    await local.open(`notes-store-${++counter}`);
  });

  afterEach(() => local.wipe());

  const ops = (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray();
  const markSynced = async (id: string, version: number) => {
    await local.db.notes.update(id, { version });
    await local.db.outbox.clear();
  };

  describe('the list', () => {
    it('loadNotes answers true once the list is in, and the list then follows the database by itself', async () => {
      await repo.create('Already there', 'x', null);

      expect(await store.loadNotes()).toBe(true);
      expect(store.notes().map((n) => n.title)).toEqual(['Already there']);
      expect(store.loadingList()).toBe(false);

      await repo.create('Added later', 'y', null);
      await vi.waitFor(() => expect(store.notes().map((n) => n.title).sort()).toEqual(['Added later', 'Already there']));
    });

    it('also follows changes made by something else (the synchronization writes straight to the database)', async () => {
      await store.loadNotes();

      await local.db.notes.put({ id: 'from-server', title: 'Pulled', createdAt: '', updatedAt: '', version: 3, notebookId: null, isPinned: false, status: 'None', tagIds: [] });

      await vi.waitFor(() => expect(store.notes().map((n) => n.title)).toEqual(['Pulled']));
    });

    it('createNote makes a note on this device, queues it, shows it in the list, and does NOT open it', async () => {
      await store.loadNotes();

      const note = await store.createNote('nb1');

      expect(note).toMatchObject({ title: 'Untitled', content: '', notebookId: 'nb1', version: 0 });
      await vi.waitFor(() => expect(store.notes().map((n) => n.id)).toEqual([note!.id]));
      expect(store.selected()).toBeNull();
      expect((await ops())[0]).toMatchObject({ entity: 'note', id: note!.id, kind: 'upsert' });
    });
  });

  describe('opening a note', () => {
    it('loadNote reads it with its text', async () => {
      const note = await repo.create('Title', 'the text', null);

      expect(await store.loadNote(note.id)).toBe('ok');

      expect(store.selected()).toMatchObject({ id: note.id, title: 'Title', content: 'the text' });
      expect(store.loadingSelected()).toBe(false);
    });

    it('reports not-found for a note that does not exist', async () => {
      expect(await store.loadNote('missing')).toBe('not-found');

      expect(store.selected()).toBeNull();
      expect(store.loadingSelected()).toBe(false);
    });

    it('the last note asked for wins, whatever the order of the answers', async () => {
      const a = await repo.create('A', '', null);
      const b = await repo.create('B', '', null);

      const first = store.loadNote(a.id);
      const second = store.loadNote(b.id);
      const results = await Promise.all([first, second]);

      expect(results).toEqual(['superseded', 'ok']); // the first caller is released, not left waiting forever
      expect(store.selected()?.id).toBe(b.id);
    });

    it('takes over a change made to the open note elsewhere (for example a pull from the server)', async () => {
      const note = await repo.create('Title', 'old', null);
      await store.loadNote(note.id);

      await local.db.contents.put({ id: note.id, content: 'text from another device' });
      await local.db.notes.update(note.id, { title: 'Title from another device', version: 4 });

      await vi.waitFor(() => expect(store.selected()).toMatchObject({ title: 'Title from another device', content: 'text from another device', version: 4 }));
      expect(store.selectedGone()).toBe(false);
    });

    it('notices when the open note disappears (deleted on another device)', async () => {
      const note = await repo.create('Title', 'x', null);
      await store.loadNote(note.id);

      await local.db.notes.delete(note.id);
      await local.db.contents.delete(note.id);

      await vi.waitFor(() => expect(store.selectedGone()).toBe(true));
      expect(store.selected()).toBeNull();
    });

    it('a new loadNote forgets an earlier "gone"', async () => {
      const a = await repo.create('A', '', null);
      const b = await repo.create('B', '', null);
      await store.loadNote(a.id);
      await local.db.notes.delete(a.id);
      await vi.waitFor(() => expect(store.selectedGone()).toBe(true));

      await store.loadNote(b.id);

      expect(store.selectedGone()).toBe(false);
    });
  });

  describe('saving', () => {
    it('saveNote writes to the database, queues the change and keeps the open note in step', async () => {
      const note = await repo.create('Title', 'old', null);
      await markSynced(note.id, 2);
      await store.loadNote(note.id);

      expect(await store.saveNote(note.id, 'Title', 'new text')).toBe('ok');

      expect(store.selected()?.content).toBe('new text');
      expect((await repo.get(note.id))?.content).toBe('new text');
      expect((await ops())[0]).toMatchObject({ baseVersion: 2, data: { content: 'new text' } });
      expect(store.saving()).toBe(false);
    });

    it('the echo of our own save does not replace the open note again (the editor must not be disturbed)', async () => {
      const note = await repo.create('Title', 'old', null);
      await store.loadNote(note.id);
      await store.saveNote(note.id, 'Title', 'new text');
      const held = store.selected();

      await sleep(60); // the live query reports the change we just made

      expect(store.selected()).toBe(held); // the very same object: nothing was replaced
    });

    it('refuses to save a note that is not the open one', async () => {
      const a = await repo.create('A', '', null);
      const b = await repo.create('B', '', null);
      await store.loadNote(a.id);

      expect(await store.saveNote(b.id, 'x', 'y')).toBe('error');
    });

    it('says not-found when the note is gone', async () => {
      const note = await repo.create('A', '', null);
      await store.loadNote(note.id);
      await local.db.notes.delete(note.id);

      expect(await store.saveNote(note.id, 'x', 'y')).toBe('not-found');
      expect(store.saving()).toBe(false);
    });
  });

  describe('organization and deletion', () => {
    it('updateOrganization changes any note, open or not, and queues only what changed', async () => {
      const note = await repo.create('T', 'b', null);
      await markSynced(note.id, 5);

      expect(await store.updateOrganization(note.id, { notebookId: 'nb', isPinned: true, status: 'None', tagIds: [] })).toBe('ok');

      expect(await repo.get(note.id)).toMatchObject({ notebookId: 'nb', isPinned: true });
      expect((await ops())[0]).toMatchObject({ baseVersion: 5, data: { notebookId: 'nb', isPinned: true } });
    });

    it('the open note follows an organization change', async () => {
      const note = await repo.create('T', 'b', null);
      await store.loadNote(note.id);

      await store.updateOrganization(note.id, { notebookId: null, isPinned: true, status: 'Active', tagIds: [] });

      await vi.waitFor(() => expect(store.selected()).toMatchObject({ isPinned: true, status: 'Active' }));
    });

    it('updateOrganization says not-found for a missing note', async () => {
      expect(await store.updateOrganization('missing', { notebookId: null, isPinned: false, status: 'None', tagIds: [] })).toBe('not-found');
    });

    it('deleteNote removes it from the list, closes it if open (without the "deleted elsewhere" notice) and queues the deletion', async () => {
      const note = await repo.create('T', 'b', null);
      await markSynced(note.id, 3);
      await store.loadNotes();
      await store.loadNote(note.id);

      expect(await store.deleteNote(note.id)).toBe(true);

      await vi.waitFor(() => expect(store.notes()).toEqual([]));
      expect(store.selected()).toBeNull();
      expect(store.selectedGone()).toBe(false);
      expect((await ops())[0]).toMatchObject({ kind: 'delete', baseVersion: 3 });
    });

    it('deleting a note that is not open leaves the open one alone', async () => {
      const open = await repo.create('Open', '', null);
      const other = await repo.create('Other', '', null);
      await store.loadNote(open.id);

      await store.deleteNote(other.id);

      expect(store.selected()?.id).toBe(open.id);
    });
  });

  it('remembers which note should get the keyboard focus in its title ("Rename")', () => {
    store.requestTitleFocus('a');
    expect(store.titleFocusFor()).toBe('a');

    store.clearTitleFocus();
    expect(store.titleFocusFor()).toBeNull();
  });
});
