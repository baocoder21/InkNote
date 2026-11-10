import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzModalService } from 'ng-zorro-antd/modal';
import { API_BASE_URL } from '../../../../core/api.config';
import { provideUi } from '../../../../core/ui.providers';
import { Note, NoteSummary } from '../../models/note.model';
import { NotesStore } from '../../store/notes.store';
import { TrashPageComponent } from './trash-page.component';

const NOTES = `${API_BASE_URL}/api/notes`;
const TRASH = `${NOTES}/trash`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (id: string, title: string): NoteSummary => ({
  id,
  title,
  updatedAt: '2026-03-04T10:00:00Z',
  version: 2,
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
});
const full = (id: string, title: string, content: string): Note => ({
  ...summary(id, title),
  content,
  createdAt: '2026-01-01T00:00:00Z',
});

describe('TrashPageComponent', () => {
  let fixture: ComponentFixture<TrashPageComponent>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const titles = () => Array.from(el().querySelectorAll('.item__title')).map((e) => e.textContent!.trim());
  const button = (label: string) => el().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  }

  /** Creates the page and answers its first request (the trash list). */
  async function show(items: NoteSummary[]) {
    fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    http.expectOne(TRASH).flush(items);
    await settle();
  }

  /** Clicks the OK button of the open confirmation dialog. */
  async function confirmDialog() {
    await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-dangerous')!.click();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideUi(), NzModalService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = '')); // close dialogs
  });

  it('shows an empty-state message and disables "Empty trash" when nothing was deleted', async () => {
    await show([]);

    expect(el().textContent).toContain('The trash is empty');
    expect(el().querySelector<HTMLButtonElement>('header button')!.disabled).toBe(true);
  });

  it('lists the deleted notes with their deletion date', async () => {
    await show([summary('a', 'First'), summary('b', 'Second')]);

    expect(titles()).toEqual(['First', 'Second']);
    expect(el().querySelector('.item__date')!.textContent).toContain('Deleted');
  });

  it('clicking a note shows its content (read only), fetched from the trash', async () => {
    await show([summary('a', 'First')]);

    el().querySelector<HTMLButtonElement>('.item__main')!.click();
    await settle();
    http.expectOne(`${TRASH}/a`).flush(full('a', 'First', 'Hello **world**'));
    await settle();
    await vi.waitFor(() => expect(el().querySelector('.markdown-body strong')?.textContent).toBe('world'));

    expect(el().querySelector('.preview__title')!.textContent).toContain('First');
    expect(el().querySelector('.preview textarea, .preview input')).toBeNull(); // nothing to edit
  });

  it('Restore posts the restore, reloads the live notes and drops the note from the list', async () => {
    await show([summary('a', 'First'), summary('b', 'Second')]);

    button('Restore note First').click();
    const restore = http.expectOne(`${TRASH}/a/restore`);
    expect(restore.request.method).toBe('POST');
    restore.flush(full('a', 'First', ''));
    await sleep(0);
    http.expectOne(NOTES).flush([summary('a', 'First')]); // the sidebar list is reloaded
    await settle();

    expect(titles()).toEqual(['Second']);
    expect(TestBed.inject(NotesStore).notes().map((n) => n.id)).toEqual(['a']);
  });

  it('Delete forever asks first and sends nothing until the user confirms', async () => {
    await show([summary('a', 'First')]);

    button('Delete note First forever').click();
    await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
    http.expectNone(`${TRASH}/a`);

    await confirmDialog();
    const request = await vi.waitFor(() => http.expectOne(`${TRASH}/a`));
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await sleep(0);
    await settle();

    expect(titles()).toEqual([]);
  });

  it('Empty trash asks first, then removes everything', async () => {
    await show([summary('a', 'First'), summary('b', 'Second')]);

    el().querySelector<HTMLButtonElement>('header button')!.click();
    await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
    expect(document.querySelector('.ant-modal-confirm')!.textContent).toContain('2 notes');
    http.expectNone(TRASH);

    await confirmDialog();
    const request = await vi.waitFor(() => http.expectOne(TRASH));
    expect(request.request.method).toBe('DELETE');
    request.flush({ deleted: 2 });
    await sleep(0);
    await settle();

    expect(el().textContent).toContain('The trash is empty');
  });
});
