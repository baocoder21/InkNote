import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideUi } from '../../../../core/ui.providers';
import { LocalDbService, OutboxOp } from '../../../sync/local/local-db';
import { NotesRepository } from '../../data/notes-repository';
import { Note } from '../../models/note.model';
import { NotesStore } from '../../store/notes.store';
import { AUTOSAVE_DELAY_MS, NoteEditorComponent } from './note-editor.component';

const NOTE: Note = {
  id: 'n1',
  title: 'Hello',
  content: '# Body',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
};

// Tests that are NOT about autosave use a delay so long that autosave can never interfere.
const NEVER = 10 * 60_000;
// Tests about autosave: short, but with wide safety margins (rendering CodeMirror in jsdom is slow).
const AUTOSAVE_TEST_DELAY = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dbCounter = 0;

/** Puts a note, as the server would have given it, into the database of this device. */
async function seed(local: LocalDbService, note: Note): Promise<void> {
  const { content, ...row } = note;
  await local.db.notes.put(row);
  await local.db.contents.put({ id: note.id, content });
}

/** Builds the component, opens note n1 (stored on "this device") and returns helpers to drive it. */
async function setup(autosaveDelay: number) {
  await TestBed.configureTestingModule({
    imports: [NoteEditorComponent],
    providers: [
      // "notes" exists so that leaving the editor (navigate to /notes) has somewhere to go.
      provideRouter([{ path: 'notes', children: [] }]),
      provideUi(),
      { provide: AUTOSAVE_DELAY_MS, useValue: autosaveDelay },
    ],
  }).compileComponents();

  const local = TestBed.inject(LocalDbService);
  await local.open(`editor-${++dbCounter}`);
  await seed(local, NOTE);
  await seed(local, { ...NOTE, id: 'n2', title: 'Other note', content: 'other' });

  const repo = TestBed.inject(NotesRepository);
  const fixture: ComponentFixture<NoteEditorComponent> = TestBed.createComponent(NoteEditorComponent);
  const el = () => fixture.nativeElement as HTMLElement;

  // Lets Angular and all pending Promises finish (async/await chains in the store and the
  // component need several microtask turns), then renders the result.
  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  }

  fixture.componentRef.setInput('id', NOTE.id);
  await settle(); // the effect starts loading the note
  await vi.waitFor(() => expect(TestBed.inject(NotesStore).selected()?.id).toBe(NOTE.id));
  await settle();

  return {
    fixture,
    local,
    repo,
    el,
    settle,
    ops: (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray(),
    titleInput: () => el().querySelector<HTMLInputElement>('input')!,
    pinButton: () => el().querySelector<HTMLButtonElement>('button.pin-btn')!,
    // There is no Save button any more: Ctrl+S inside the editor saves.
    pressCtrlS() {
      el().dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    },
    typeTitle(text: string) {
      const input = el().querySelector<HTMLInputElement>('input')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
    },
  };
}

describe('NoteEditorComponent', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    t = await setup(NEVER);
  });

  afterEach(() => t.local.wipe());

  it('shows the loaded note in the Markdown editor, with nothing unsaved and no Save or delete button', () => {
    expect(t.titleInput().value).toBe('Hello');
    expect(t.el().querySelector('.cm-content')?.textContent).toContain('# Body');
    // No status line at the bottom ("All changes saved · Updated ... · Version n"): removed on purpose.
    expect(t.el().querySelector('.meta')).toBeNull();
    expect(t.el().textContent).not.toContain('All changes saved');
    expect(t.el().textContent).not.toContain('Version');
    // Notes save by themselves and with Ctrl+S; deleting is done from the sidebar menu.
    expect(t.el().querySelector('button.save-btn')).toBeNull();
    expect(t.el().querySelector('[aria-label="Delete note"]')).toBeNull();
  });

  it('Ctrl+S writes the edited title to this device and queues it, on top of the version it was based on', async () => {
    t.typeTitle('Hello, edited');
    await t.settle();

    t.pressCtrlS();

    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Hello, edited'));
    expect(await t.ops()).toMatchObject([{ entity: 'note', id: NOTE.id, kind: 'upsert', baseVersion: 1, data: { title: 'Hello, edited' } }]);
    await t.settle();
    expect(t.titleInput().value).toBe('Hello, edited');
  });

  it('does not need the network: nothing but the local database is involved (no HTTP provider is even configured)', async () => {
    t.typeTitle('Offline edit');
    await t.settle();
    t.pressCtrlS();

    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Offline edit'));
  });

  describe('rename request from the sidebar', () => {
    const store = () => TestBed.inject(NotesStore);

    it('puts the cursor in the title and selects its text, then clears the request', async () => {
      store().requestTitleFocus(NOTE.id);
      await t.settle();
      await sleep(10); // the focus happens one tick later, after ngModel wrote the text

      const box = t.titleInput();
      expect(document.activeElement).toBe(box);
      expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
      expect(store().titleFocusFor()).toBeNull();
    });

    it('ignores a request for another note (it stays pending for that note)', async () => {
      store().requestTitleFocus('another-note');
      await t.settle();
      await sleep(10);

      expect(document.activeElement).not.toBe(t.titleInput());
      expect(store().titleFocusFor()).toBe('another-note');
    });
  });

  it('Enter in the title saves right away (without waiting for the autosave delay)', async () => {
    t.typeTitle('Renamed');
    await t.settle();

    t.titleInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Renamed'));
  });

  it('pins the note without touching the text or the unsaved draft', async () => {
    t.typeTitle('Draft not saved yet');
    await t.settle();
    expect(t.pinButton().getAttribute('aria-pressed')).toBe('false');

    t.pinButton().click();
    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.isPinned).toBe(true));
    await t.settle();

    expect(t.pinButton().getAttribute('aria-pressed')).toBe('true');
    expect(t.titleInput().value).toBe('Draft not saved yet'); // the draft survived
    expect((await t.repo.get(NOTE.id))?.title).toBe('Hello'); // ...and it is not saved yet

    // ...it is still waiting to be saved: Ctrl+S stores it.
    t.pressCtrlS();
    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Draft not saved yet'));
    expect((await t.repo.get(NOTE.id))?.isPinned).toBe(true);
  });

  it('saves the draft of the current note before opening another one', async () => {
    t.typeTitle('Unsaved draft');
    await t.settle();

    // The user clicks another note in the list: the route id changes.
    t.fixture.componentRef.setInput('id', 'n2');
    t.fixture.detectChanges();
    await t.fixture.whenStable();

    await vi.waitFor(async () => expect((await t.repo.get('n1'))?.title).toBe('Unsaved draft'));
    await vi.waitFor(() => expect(TestBed.inject(NotesStore).selected()?.id).toBe('n2'));
    await t.settle();
    expect(t.titleInput().value).toBe('Other note');
  });

  describe('changes that arrive from elsewhere (the synchronization with the server)', () => {
    it('shows them when the user has not typed anything', async () => {
      await t.local.db.contents.put({ id: NOTE.id, content: 'text from another device' });
      await t.local.db.notes.update(NOTE.id, { title: 'Title from another device', version: 2, updatedAt: '2026-02-02T00:00:00Z' });

      await vi.waitFor(() => expect(TestBed.inject(NotesStore).selected()?.title).toBe('Title from another device'));
      await t.settle();

      expect(t.titleInput().value).toBe('Title from another device');
      expect(t.el().querySelector('.cm-content')?.textContent).toContain('text from another device');
    });

    it('never swallow what the user is typing', async () => {
      t.typeTitle('My unsaved title');
      await t.settle();

      await t.local.db.notes.update(NOTE.id, { title: 'Title from another device', version: 2, updatedAt: '2026-02-02T00:00:00Z' });
      await vi.waitFor(() => expect(TestBed.inject(NotesStore).selected()?.title).toBe('Title from another device'));
      await t.settle();

      expect(t.titleInput().value).toBe('My unsaved title');
    });

    it('has no conflict banner any more (conflicts are settled by the server, nothing to ask the user here)', async () => {
      t.typeTitle('Mine');
      await t.settle();
      t.pressCtrlS();
      await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Mine'));
      await t.settle();

      expect(t.el().querySelector('.banner')).toBeNull();
    });
  });

  it('leaves the note when it is deleted on another device', async () => {
    const router = TestBed.inject(Router);

    await t.local.db.notes.delete(NOTE.id);
    await t.local.db.contents.delete(NOTE.id);

    await vi.waitFor(() => expect(TestBed.inject(NotesStore).selectedGone()).toBe(true));
    await t.settle();
    await vi.waitFor(() => expect(router.url).toBe('/notes'));
  });
});

describe('NoteEditorComponent autosave', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    t = await setup(AUTOSAVE_TEST_DELAY);
  });

  afterEach(() => t.local.wipe());

  it('saves by itself after the user stops typing, without needing the Save button', async () => {
    t.typeTitle('Auto saved');
    t.fixture.detectChanges();
    expect((await t.repo.get(NOTE.id))?.title).toBe('Hello'); // not yet: the user may still be typing

    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('Auto saved'), { timeout: AUTOSAVE_TEST_DELAY + 2000 });
    await t.settle();

    expect(t.titleInput().value).toBe('Auto saved');
    expect(await t.ops()).toMatchObject([{ kind: 'upsert', baseVersion: 1, data: { title: 'Auto saved' } }]);
  });

  it('restarts the timer on every edit (only the last text is saved)', async () => {
    t.typeTitle('A');
    t.fixture.detectChanges();
    await sleep(AUTOSAVE_TEST_DELAY - 200);

    t.typeTitle('AB'); // typing again before the delay passed postpones the save
    t.fixture.detectChanges();
    await sleep(AUTOSAVE_TEST_DELAY - 200); // 'A' alone would have been saved by now
    expect((await t.repo.get(NOTE.id))?.title).toBe('Hello');

    await vi.waitFor(async () => expect((await t.repo.get(NOTE.id))?.title).toBe('AB'), { timeout: 2000 });
    expect(await t.ops()).toMatchObject([{ data: { title: 'AB' } }]); // one save, not two
  });
});
