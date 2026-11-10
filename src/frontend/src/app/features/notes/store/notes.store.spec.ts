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
    ...overrides,
  };
}

function summary(n: Note): NoteSummary {
  return { id: n.id, title: n.title, updatedAt: n.updatedAt, version: n.version };
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

  it('loadNotes fills the list and the count', async () => {
    const promise = store.loadNotes();
    http.expectOne(URL).flush([summary(note('a')), summary(note('b'))]);

    expect(await promise).toBe(true);
    expect(store.count()).toBe(2);
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

  it('createNote puts the new note first without changing the current selection', async () => {
    const existing = note('old');
    const loading = store.loadNotes();
    http.expectOne(URL).flush([summary(existing)]);
    await loading;
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

  it('saveNote sends the current version and moves the note to the top', async () => {
    const a = note('a');
    const b = note('b');
    const loading = store.loadNotes();
    http.expectOne(URL).flush([summary(b), summary(a)]); // b is first
    await loading;
    await open(a);

    const promise = store.saveNote('a', 'Edited', 'New body');
    const request = http.expectOne(`${URL}/a`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ title: 'Edited', content: 'New body', version: 1 });
    request.flush(note('a', { title: 'Edited', content: 'New body', version: 2 }));

    expect(await promise).toBe('ok');
    expect(store.selected()?.version).toBe(2);
    expect(store.notes().map((n) => n.id)).toEqual(['a', 'b']);
    expect(store.notes()[0].title).toBe('Edited');
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

  it('deleteNote removes the note and clears the selection', async () => {
    const a = note('a');
    const loading = store.loadNotes();
    http.expectOne(URL).flush([summary(a), summary(note('b'))]);
    await loading;
    await open(a);

    const promise = store.deleteNote('a');
    const request = http.expectOne(`${URL}/a`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await promise).toBe(true);
    expect(store.notes().map((n) => n.id)).toEqual(['b']);
    expect(store.selected()).toBeNull();
  });
});
