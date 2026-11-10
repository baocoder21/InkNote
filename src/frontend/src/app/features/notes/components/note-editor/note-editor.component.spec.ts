import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../../../core/api.config';
import { provideUi } from '../../../../core/ui.providers';
import { Note } from '../../models/note.model';
import { AUTOSAVE_DELAY_MS, NoteEditorComponent } from './note-editor.component';

const URL = `${API_BASE_URL}/api/notes`;

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

/** Builds the component, opens note n1 and returns helpers to drive it. */
async function setup(autosaveDelay: number) {
  await TestBed.configureTestingModule({
    imports: [NoteEditorComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideUi(),
      { provide: AUTOSAVE_DELAY_MS, useValue: autosaveDelay },
    ],
  }).compileComponents();

  const http = TestBed.inject(HttpTestingController);
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
  http.expectOne(`${URL}/${NOTE.id}`).flush(NOTE);
  await settle();

  return {
    fixture,
    http,
    el,
    settle,
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

  afterEach(() => t.http.verify());

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

  it('Ctrl+S sends the edited text with the current version', async () => {
    t.typeTitle('Hello, edited');
    await t.settle();

    t.pressCtrlS();
    const request = t.http.expectOne(`${URL}/${NOTE.id}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      title: 'Hello, edited',
      content: '# Body',
      version: 1,
    });
    request.flush({ ...NOTE, title: 'Hello, edited', version: 2 });
    await t.settle();

    // After a successful save the draft matches the server again (afterEach verifies that no
    // further request is pending).
    expect(t.titleInput().value).toBe('Hello, edited');
  });

  it('shows the conflict banner when the server answers 409', async () => {
    t.typeTitle('Mine');
    await t.settle();

    t.pressCtrlS();
    t.http.expectOne(`${URL}/${NOTE.id}`).flush('', { status: 409, statusText: 'Conflict' });
    await t.settle();

    const banner = t.el().querySelector('.banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('changed somewhere else');
    expect(t.titleInput().value).toBe('Mine'); // the user's text is not thrown away
  });

  it('pins the note without touching the text or the unsaved draft', async () => {
    t.typeTitle('Draft not saved yet');
    await t.settle();
    expect(t.pinButton().getAttribute('aria-pressed')).toBe('false');

    t.pinButton().click();
    const request = t.http.expectOne(`${URL}/${NOTE.id}/organization`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ notebookId: null, isPinned: true, status: 'None', tagIds: [], version: 1 });
    // The server answers with the last SAVED text ("Hello"), not the draft.
    request.flush({ ...NOTE, version: 2, isPinned: true });
    await t.settle();

    expect(t.pinButton().getAttribute('aria-pressed')).toBe('true');
    expect(t.titleInput().value).toBe('Draft not saved yet'); // the draft survived

    // ...and it is still waiting to be saved: Ctrl+S sends it, on top of the NEW version (2).
    t.pressCtrlS();
    const save = t.http.expectOne(`${URL}/${NOTE.id}`);
    expect(save.request.body).toEqual({ title: 'Draft not saved yet', content: '# Body', version: 2 });
    save.flush({ ...NOTE, title: 'Draft not saved yet', version: 3, isPinned: true });
    await t.settle();
  });

  it('shows the conflict banner when the server rejects the organization change with 409', async () => {
    t.pinButton().click();
    t.http.expectOne(`${URL}/${NOTE.id}/organization`).flush('', { status: 409, statusText: 'Conflict' });
    await t.settle();

    expect(t.el().querySelector('.banner')).not.toBeNull();
    expect(t.pinButton().getAttribute('aria-pressed')).toBe('false'); // nothing changed locally
  });

  it('saves the draft of the current note before opening another one', async () => {
    t.typeTitle('Unsaved draft');
    await t.settle();

    // The user clicks another note in the list: the route id changes.
    t.fixture.componentRef.setInput('id', 'n2');
    t.fixture.detectChanges();
    await t.fixture.whenStable();

    const save = t.http.expectOne(`${URL}/n1`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body.title).toBe('Unsaved draft');
    save.flush({ ...NOTE, title: 'Unsaved draft', version: 2 });
    await t.settle();

    // Only after that the next note is downloaded.
    t.http.expectOne(`${URL}/n2`).flush({ ...NOTE, id: 'n2', title: 'Other note' });
    await t.settle();
    expect(t.titleInput().value).toBe('Other note');
  });
});

describe('NoteEditorComponent autosave', () => {
  let t: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    t = await setup(AUTOSAVE_TEST_DELAY);
  });

  afterEach(() => t.http.verify());

  it('saves by itself after the user stops typing, without needing the Save button', async () => {
    t.typeTitle('Auto saved');
    t.fixture.detectChanges();
    t.http.expectNone(`${URL}/${NOTE.id}`); // not yet: the user may still be typing

    await sleep(AUTOSAVE_TEST_DELAY + 300);
    const request = t.http.expectOne(`${URL}/${NOTE.id}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ title: 'Auto saved', content: '# Body', version: 1 });
    request.flush({ ...NOTE, title: 'Auto saved', version: 2 });
    await t.settle();

    expect(t.titleInput().value).toBe('Auto saved');
  });

  it('restarts the timer on every edit (only the last text is saved)', async () => {
    t.typeTitle('A');
    t.fixture.detectChanges();
    await sleep(AUTOSAVE_TEST_DELAY - 200);

    t.typeTitle('AB'); // typing again before the delay passed postpones the save
    t.fixture.detectChanges();
    await sleep(AUTOSAVE_TEST_DELAY - 200); // 'A' alone would have been saved by now
    t.http.expectNone(`${URL}/${NOTE.id}`);

    await sleep(400);
    const request = t.http.expectOne(`${URL}/${NOTE.id}`);
    expect(request.request.body.title).toBe('AB');
    request.flush({ ...NOTE, title: 'AB', version: 2 });
    await t.settle();
  });

  it('does not autosave while a version conflict is unresolved', async () => {
    t.typeTitle('Mine');
    await t.settle();
    t.pressCtrlS();
    t.http.expectOne(`${URL}/${NOTE.id}`).flush('', { status: 409, statusText: 'Conflict' });
    await t.settle();

    t.typeTitle('Mine again');
    t.fixture.detectChanges();
    await sleep(AUTOSAVE_TEST_DELAY + 300);

    t.http.expectNone(`${URL}/${NOTE.id}`);
  });
});
