import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { provideUi } from '../../../../core/ui.providers';
import { AttachmentRepository } from '../../../attachments/data/attachment-repository';
import { LocalDbService } from '../../../sync/local/local-db';
import { NotesStore } from '../../store/notes.store';
import { AUTOSAVE_DELAY_MS, NoteEditorComponent } from './note-editor.component';

let dbCounter = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The note editor with note "n1" open, on a local database of its own. */
async function open() {
  await TestBed.configureTestingModule({
    imports: [NoteEditorComponent],
    providers: [
      provideRouter([{ path: 'notes', children: [] }]),
      provideUi(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AUTOSAVE_DELAY_MS, useValue: 10 * 60_000 }, // not what these tests are about
    ],
  }).compileComponents();

  const local = TestBed.inject(LocalDbService);
  await local.open(`editor-files-${++dbCounter}`);
  await local.db.notes.put({ id: 'n1', title: 'Hello', createdAt: '', updatedAt: '', version: 1, notebookId: null, isPinned: false, status: 'None', tagIds: [] });
  await local.db.contents.put({ id: 'n1', content: 'Start.' });

  const fixture: ComponentFixture<NoteEditorComponent> = TestBed.createComponent(NoteEditorComponent);
  fixture.componentRef.setInput('id', 'n1');
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  };
  await settle();
  await vi.waitFor(() => expect(TestBed.inject(NotesStore).selected()?.id).toBe('n1'));
  await settle();

  /** What a browser does when the user pastes files into the editor. */
  const paste = (...files: File[]) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, types: ['Files'], getData: () => '' } });
    (fixture.nativeElement as HTMLElement).querySelector('.cm-content')!.dispatchEvent(event);
    return event;
  };
  return { fixture, local, settle, paste, editorText: () => (fixture.nativeElement as HTMLElement).querySelector('.cm-content')!.textContent ?? '' };
}

const png = (name: string) => new File([new Uint8Array(40).fill(5)], name, { type: 'image/png' });

describe('NoteEditorComponent: files pasted or dropped into the note', () => {
  let t: Awaited<ReturnType<typeof open>>;

  beforeEach(async () => {
    t = await open();
  });

  afterEach(() => t.local.wipe());

  it('an image is stored on this device, queued for upload, and its Markdown appears in the text', async () => {
    const event = t.paste(png('Holiday photo.png'));

    await vi.waitFor(() => expect(t.editorText()).toMatch(/!\[Holiday photo\]\(attachment:[0-9a-f-]{36}\)/));
    expect(event.defaultPrevented).toBe(true); // the browser did not also paste something
    const [upload] = await TestBed.inject(AttachmentRepository).uploads();
    expect(upload).toMatchObject({ noteId: 'n1', attempts: 0 });
    expect(t.editorText()).toContain(`attachment:${upload.id})`); // the link names exactly the queued file
    expect(await TestBed.inject(AttachmentRepository).blob(upload.id)).toMatchObject({ name: 'Holiday photo.png', type: 'image/png', size: 40 });
    expect(t.editorText()).toContain('Start.'); // the rest of the text is untouched
  });

  it('a file that is not an image is written as a link', async () => {
    t.paste(new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' }));

    await vi.waitFor(() => expect(t.editorText()).toMatch(/\[report\.pdf\]\(attachment:[0-9a-f-]{36}\)/));
    expect(t.editorText()).not.toContain('![report');
  });

  it('several files are written one per line', async () => {
    t.paste(png('a.png'), png('b.png'));

    await vi.waitFor(() => expect((t.editorText().match(/attachment:/g) ?? []).length).toBe(2));
    expect(await TestBed.inject(AttachmentRepository).uploads()).toHaveLength(2);
  });

  it('a refused file is reported to the user and writes nothing and queues nothing', async () => {
    const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');

    t.paste(new File(['<svg onload=alert(1)/>'], 'logo.svg', { type: 'image/svg+xml' }));

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(String(error.mock.calls[0][0])).toContain('"logo.svg"');
    expect(String(error.mock.calls[0][0])).toContain('not allowed');
    expect(t.editorText()).not.toContain('attachment:');
    expect(await TestBed.inject(AttachmentRepository).uploads()).toEqual([]);
  });

  it('the accepted files of a mixed paste are kept and the refused one is reported', async () => {
    const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');

    t.paste(png('good.png'), new File(['MZ'], 'run.exe'));

    await vi.waitFor(() => expect(t.editorText()).toContain('![good]'));
    expect(error).toHaveBeenCalledTimes(1);
    expect(await TestBed.inject(AttachmentRepository).uploads()).toHaveLength(1);
  });

  it('text is still pasted as text (nothing is stored)', async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: () => ' typed words' } });

    t.fixture.nativeElement.querySelector('.cm-content').dispatchEvent(event);
    await t.settle();

    expect(await TestBed.inject(AttachmentRepository).uploads()).toEqual([]);
    expect(t.editorText()).toContain('typed words');
  });
});
