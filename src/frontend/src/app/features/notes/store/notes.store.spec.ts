import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api.config';
import { Note, NoteSummary } from '../models/note.model';
import { NotesStore } from './notes.store';

const URL = `${API_BASE_URL}/api/notes`;

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Title ${id}`,
    content: `Content ${id}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    notebookId: null,
    isPinned: false,
    status: 'None',
    tagIds: [],
    ...overrides,
  };
}

function summary(n: Note): NoteSummary {
  return {
    id: n.id,
    title: n.title,
    updatedAt: n.updatedAt,
    version: n.version,
    notebookId: n.notebookId,
    isPinned: n.isPinned,
    status: n.status,
    tagIds: n.tagIds,
  };
}

describe('NotesStore', () => {
  let store: InstanceType<typeof NotesStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(NotesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // Opens a note in the store the same way a component would.
  async function open(n: Note): Promise<void> {
    const promise = store.loadNote(n.id);
    http.expectOne(`${URL}/${n.id}`).flush(n);
    await promise;
  }

  // Fills the list the same way the notes page does.
  async function listed(...notes: Note[]): Promise<void> {
    const promise = store.loadNotes();
    http.expectOne(URL).flush(notes.map(summary));
    await promise;
  }

  it('requestTitleFocus remembers which note should get its title focused, clearTitleFocus forgets it', () => {
    expect(store.titleFocusFor()).toBeNull();

    store.requestTitleFocus('a');
    expect(store.titleFocusFor()).toBe('a');

    store.clearTitleFocus();
    expect(store.titleFocusFor()).toBeNull();
  });

  it('loadNotes asks for every note and fills the list', async () => {
    const promise = store.loadNotes();
    const request = http.expectOne(URL);
    expect(request.request.params.keys()).toEqual([]); // no filter: the sidebar filters by itself
    request.flush([summary(note('a')), summary(note('b'))]);

    expect(await promise).toBe(true);
    expect(store.notes().map((n) => n.id)).toEqual(['a', 'b']);
    expect(store.loadingList()).toBe(false);
  });

  it('loadNotes returns false and stops loading when the request fails', async () => {
    const promise = store.loadNotes();
    http.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(await promise).toBe(false);
    expect(store.loadingList()).toBe(false);
  });

  it('loadNote selects the downloaded note', async () => {
    await open(note('a'));

    expect(store.selected()?.id).toBe('a');
    expect(store.loadingSelected()).toBe(false);
  });

  it('loadNote reports not-found on 404', async () => {
    const promise = store.loadNote('missing');
    http.expectOne(`${URL}/missing`).flush('', { status: 404, statusText: 'Not Found' });

    expect(await promise).toBe('not-found');
    expect(store.selected()).toBeNull();
  });

  it('loadNote ignores an outdated response (race condition)', async () => {
    const first = store.loadNote('a');
    const second = store.loadNote('b');

    // The newer request (b) answers first, the older one (a) arrives late.
    http.expectOne(`${URL}/b`).flush(note('b'));
    http.expectOne(`${URL}/a`).flush(note('a'));
    await Promise.all([first, second]);

    expect(store.selected()?.id).toBe('b');
  });

  describe('createNote', () => {
    it('adds the new note to the list without changing the current selection', async () => {
      const existing = note('old');
      await listed(existing);
      await open(existing);

      const promise = store.createNote();
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ title: 'Untitled', content: '' });
      request.flush(note('new', { title: 'Untitled', content: '' }));

      expect((await promise)?.id).toBe('new');
      expect(store.notes().map((n) => n.id)).toEqual(['new', 'old']);
      // Still the old note: the editor needs it to save its draft before switching.
      expect(store.selected()?.id).toBe('old');
    });

    it('files the note into the given notebook', async () => {
      const promise = store.createNote('nb1');
      const request = http.expectOne(URL);
      expect(request.request.body).toEqual({ title: 'Untitled', content: '', notebookId: 'nb1' });
      request.flush(note('new', { notebookId: 'nb1' }));

      expect((await promise)?.notebookId).toBe('nb1');
      expect(store.notes()[0].notebookId).toBe('nb1');
    });

    it('returns null when the server refuses', async () => {
      const promise = store.createNote('missing');
      http.expectOne(URL).flush('', { status: 400, statusText: 'Bad Request' });

      expect(await promise).toBeNull();
      expect(store.notes()).toEqual([]);
    });
  });

  it('saveNote sends the current version and updates the note in place', async () => {
    const a = note('a');
    const b = note('b');
    await listed(b, a);
    await open(a);

    const promise = store.saveNote('a', 'Edited', 'New body');
    const request = http.expectOne(`${URL}/a`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ title: 'Edited', content: 'New body', version: 1 });
    request.flush(note('a', { title: 'Edited', content: 'New body', version: 2 }));

    expect(await promise).toBe('ok');
    expect(store.selected()?.version).toBe(2);
    // Same position in the list (the sidebar sorts by itself), with the new title and version.
    expect(store.notes().map((n) => n.id)).toEqual(['b', 'a']);
    expect(store.notes()[1]).toMatchObject({ title: 'Edited', version: 2 });
    expect(store.saving()).toBe(false);
  });

  it('saveNote returns "conflict" on 409 and keeps the local data', async () => {
    await open(note('a'));

    const promise = store.saveNote('a', 'Mine', 'Mine');
    http.expectOne(`${URL}/a`).flush('', { status: 409, statusText: 'Conflict' });

    expect(await promise).toBe('conflict');
    expect(store.selected()?.title).toBe('Title a'); // unchanged
    expect(store.saving()).toBe(false);
  });

  describe('updateOrganization', () => {
    const CHANGE = { notebookId: 'nb1', isPinned: true, status: 'None' as const, tagIds: ['t1'] };

    it('sends the version, and merges ONLY the organization fields into the open note', async () => {
      await listed(note('a'));
      await open(note('a'));

      const promise = store.updateOrganization('a', CHANGE);
      const request = http.expectOne(`${URL}/a/organization`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ ...CHANGE, version: 1 });
      expect(store.saving()).toBe(true); // blocks the editor's autosave meanwhile
      // The server replies with the last SAVED text; the unsaved draft in the editor must survive.
      request.flush(
        note('a', { title: 'Saved title on server', version: 2, notebookId: 'nb1', isPinned: true, tagIds: ['t1'] }),
      );

      expect(await promise).toBe('ok');
      const selected = store.selected()!;
      expect(selected).toMatchObject({ version: 2, isPinned: true, notebookId: 'nb1', tagIds: ['t1'] });
      expect(selected.title).toBe('Title a'); // untouched
      expect(store.saving()).toBe(false);
      // The list entry follows, and keeps its own title.
      expect(store.notes()[0]).toMatchObject({ title: 'Title a', version: 2, isPinned: true, notebookId: 'nb1' });
    });

    it('works for a note that is not open, using the version from the list', async () => {
      await listed(note('a'), note('b', { version: 5 }));
      await open(note('a'));

      const promise = store.updateOrganization('b', CHANGE);
      const request = http.expectOne(`${URL}/b/organization`);
      expect(request.request.body).toEqual({ ...CHANGE, version: 5 });
      expect(store.saving()).toBe(false); // the open note's autosave is not blocked
      request.flush(note('b', { version: 6, notebookId: 'nb1', isPinned: true, tagIds: ['t1'] }));

      expect(await promise).toBe('ok');
      expect(store.notes().find((n) => n.id === 'b')).toMatchObject({ version: 6, isPinned: true });
      expect(store.selected()).toMatchObject({ id: 'a', version: 1, isPinned: false }); // not touched
    });

    it('maps 409 to "conflict", 400 to "invalid" and keeps the data', async () => {
      await open(note('a'));

      const conflict = store.updateOrganization('a', CHANGE);
      http.expectOne(`${URL}/a/organization`).flush('', { status: 409, statusText: 'Conflict' });
      expect(await conflict).toBe('conflict');

      const invalid = store.updateOrganization('a', CHANGE);
      http.expectOne(`${URL}/a/organization`).flush('', { status: 400, statusText: 'Bad Request' });
      expect(await invalid).toBe('invalid');

      expect(store.selected()?.version).toBe(1);
      expect(store.selected()?.isPinned).toBe(false);
      expect(store.saving()).toBe(false);
    });

    it('does nothing for a note it does not know', async () => {
      await open(note('a'));

      expect(await store.updateOrganization('unknown', CHANGE)).toBe('error');
    });
  });

  it('deleteNote removes the note and clears the selection', async () => {
    const a = note('a');
    await listed(a, note('b'));
    await open(a);

    const promise = store.deleteNote('a');
    const request = http.expectOne(`${URL}/a`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await promise).toBe(true);
    expect(store.notes().map((n) => n.id)).toEqual(['b']);
    expect(store.selected()).toBeNull();
  });

  it('deleteNote keeps the open note when another note is deleted', async () => {
    await listed(note('a'), note('b'));
    await open(note('a'));

    const promise = store.deleteNote('b');
    http.expectOne(`${URL}/b`).flush(null, { status: 204, statusText: 'No Content' });

    expect(await promise).toBe(true);
    expect(store.selected()?.id).toBe('a');
  });
});
