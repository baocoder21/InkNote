import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { API_BASE_URL } from '../../../../core/api.config';
import { provideUi } from '../../../../core/ui.providers';
import { LocalDbService } from '../../../sync/local/local-db';
import { SyncEngine } from '../../../sync/sync-engine.service';
import { NoteRevision, NoteRevisionSummary } from '../../models/revision.model';
import { NoteHistoryPageComponent } from './note-history-page.component';

const NOTES = `${API_BASE_URL}/api/notes`;
let dbCounter = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (id: string, reason: string, title: string, preview: string, createdAt: string): NoteRevisionSummary => ({
  id,
  noteId: 'n1',
  title,
  preview,
  contentLength: preview.length,
  noteVersion: 3,
  reason,
  createdAt,
});
const full = (id: string, title: string, content: string): NoteRevision => ({ id, noteId: 'n1', title, content, noteVersion: 3, reason: 'edit', createdAt: '2026-03-04T10:00:00Z' });

const LIST = [
  summary('r2', 'conflict', 'Plan', 'text from the phone', '2026-03-04T12:00:00Z'),
  summary('r1', 'edit', 'Plan v1', 'the first draft', '2026-03-04T09:00:00Z'),
];

describe('NoteHistoryPageComponent', () => {
  let fixture: ComponentFixture<NoteHistoryPageComponent>;
  let http: HttpTestingController;
  let local: LocalDbService;
  let syncNow: ReturnType<typeof vi.fn>;
  let calls: string[];

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el().querySelectorAll('.item'));
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  };
  const listRequest = () => vi.waitFor(() => http.expectOne(`${NOTES}/n1/revisions`));
  const showList = async (items = LIST) => {
    (await listRequest()).flush(items);
    await settle();
  };
  const press = (label: string) => Array.from(el().querySelectorAll('button')).find((b) => b.textContent!.includes(label))!.click();

  beforeEach(async () => {
    calls = [];
    syncNow = vi.fn(async () => void calls.push('sync'));
    await TestBed.configureTestingModule({
      imports: [NoteHistoryPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'notes/:id', children: [] }]),
        provideUi(),
        NzModalService,
        { provide: SyncEngine, useValue: { syncNow } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    local = TestBed.inject(LocalDbService);
    await local.open(`history-${++dbCounter}`);
    await local.db.notes.put({ id: 'n1', title: 'Plan', createdAt: '', updatedAt: '', version: 3, notebookId: null, isPinned: false, status: 'None', tagIds: [] });
    await local.db.contents.put({ id: 'n1', content: 'current text' });

    fixture = TestBed.createComponent(NoteHistoryPageComponent);
    fixture.componentRef.setInput('id', 'n1');
    fixture.detectChanges();
  });

  afterEach(async () => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
    await local.wipe();
  });

  describe('the list', () => {
    it('shows the older versions, newest first, with when, why, the title and the beginning of the text', async () => {
      await showList();

      expect(rows()).toHaveLength(2);
      expect(rows()[0].textContent).toContain('Replaced by a change from another device');
      expect(rows()[0].textContent).toContain('text from the phone');
      expect(rows()[1].textContent).toContain('Before an edit');
      expect(rows()[1].textContent).toContain('Plan v1');
      expect(rows()[1].textContent).toContain('the first draft');
    });

    it('names the note in the heading and links back to it', async () => {
      await showList();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el().querySelector('.head__hint')!.textContent).toContain('"Plan"');
      });

      expect(el().querySelector('a.head__back')!.getAttribute('href')).toBe('/notes/n1');
    });

    it('says so when the note has no older versions yet', async () => {
      await showList([]);

      expect(el().textContent).toContain('No older versions yet');
      expect(rows()).toHaveLength(0);
    });

    it('says the history needs a connection when offline, and "Try again" asks again', async () => {
      (await listRequest()).error(new ProgressEvent('error'));
      await settle();
      expect(el().textContent).toContain('connect to the internet');

      press('Try again');
      await showList();

      expect(rows()).toHaveLength(2);
    });

    it('says so when the server does not know the note (a 404), and for any other problem', async () => {
      (await listRequest()).flush({}, { status: 404, statusText: 'Not Found' });
      await settle();
      expect(el().textContent).toContain('no history on the server');

      press('Try again');
      (await listRequest()).flush({}, { status: 500, statusText: 'Error' });
      await settle();
      expect(el().textContent).toContain('cannot be loaded now');
    });
  });

  describe('looking at one version', () => {
    it('loads its whole text and shows it read-only with a Restore button', async () => {
      await showList();
      expect(el().textContent).toContain('Select a version');

      rows()[1].querySelector<HTMLButtonElement>('.item__main')!.click();
      http.expectOne(`${NOTES}/n1/revisions/r1`).flush(full('r1', 'Plan v1', 'The **first** draft'));
      await settle();

      expect(el().querySelector('.preview__title')!.textContent).toBe('Plan v1');
      await vi.waitFor(() => expect(el().querySelector('.markdown-body strong')?.textContent).toBe('first'), { timeout: 10_000 });
      expect(rows()[1].classList).toContain('item--selected');
      expect(Array.from(el().querySelectorAll('button')).some((b) => b.textContent!.includes('Restore this version'))).toBe(true);
    });

    it('does not ask again for the version that is already shown', async () => {
      await showList();
      const button = rows()[1].querySelector<HTMLButtonElement>('.item__main')!;
      button.click();
      http.expectOne(`${NOTES}/n1/revisions/r1`).flush(full('r1', 'Plan v1', 'draft'));
      await settle();

      button.click();
      await settle();

      http.expectNone(`${NOTES}/n1/revisions/r1`);
    });

    it('tells the user when a version cannot be loaded, and shows nothing for it', async () => {
      const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');
      await showList();

      rows()[0].querySelector<HTMLButtonElement>('.item__main')!.click();
      http.expectOne(`${NOTES}/n1/revisions/r2`).error(new ProgressEvent('error'));
      await settle();

      expect(error).toHaveBeenCalled();
      expect(el().textContent).toContain('Select a version');
    });
  });

  describe('putting a version back', () => {
    async function selectOldest() {
      await showList();
      rows()[1].querySelector<HTMLButtonElement>('.item__main')!.click();
      http.expectOne(`${NOTES}/n1/revisions/r1`).flush(full('r1', 'Plan v1', 'the first draft'));
      await settle();
    }

    const confirm = async () => {
      await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
      document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')!.click();
    };

    it('asks first, and does nothing when the user cancels', async () => {
      await selectOldest();

      press('Restore this version');
      await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
      expect(document.querySelector('.ant-modal-confirm')!.textContent).toContain('saved in the history first');
      document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns button:not(.ant-btn-primary)')!.click();
      await sleep(30);

      http.expectNone((r) => r.method === 'POST');
      expect(syncNow).not.toHaveBeenCalled();
    });

    it('sends what is waiting FIRST, then restores, then brings the restored text here, then goes back to the note', async () => {
      const success = vi.spyOn(TestBed.inject(NzMessageService), 'success');
      await selectOldest();

      press('Restore this version');
      await confirm();
      const post = await vi.waitFor(() => {
        const request: TestRequest = http.expectOne(`${NOTES}/n1/revisions/r1/restore`);
        calls.push('post');
        return request;
      });
      expect(post.request.method).toBe('POST');
      expect(calls).toEqual(['sync', 'post']); // the text typed here reached the server before the restore did
      post.flush({ id: 'n1' });

      await vi.waitFor(() => expect(calls).toEqual(['sync', 'post', 'sync']));
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/notes/n1'));
      expect(success).toHaveBeenCalledWith('Version restored');
    });

    it('does not restore while this note still has changes that were not sent (they would come after it and win)', async () => {
      const warning = vi.spyOn(TestBed.inject(NzMessageService), 'warning');
      await selectOldest();
      await local.db.outbox.add({ opId: crypto.randomUUID(), entity: 'note', id: 'n1', kind: 'upsert', baseVersion: 3, data: { content: 'typed offline' }, awaitsBase: false, attempted: false, createdAt: '' });

      press('Restore this version');
      await confirm();

      await vi.waitFor(() => expect(warning).toHaveBeenCalled());
      expect(String(warning.mock.calls[0][0])).toContain('have not been sent yet');
      http.expectNone((r) => r.method === 'POST');
      expect(TestBed.inject(Router).url).not.toBe('/notes/n1');
    });

    it.each([
      [0, 'needs a connection'],
      [404, 'no longer exists'],
    ])('tells the user when the server answers %i, and stays on the page', async (status, words) => {
      const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');
      await selectOldest();

      press('Restore this version');
      await confirm();
      const post = await vi.waitFor(() => http.expectOne(`${NOTES}/n1/revisions/r1/restore`));
      if (status === 0) post.error(new ProgressEvent('error'));
      else post.flush({}, { status, statusText: 'No' });

      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(String(error.mock.calls[0][0])).toContain(words);
      expect(TestBed.inject(Router).url).not.toBe('/notes/n1');
    });

    it('a 409 (the note changed meanwhile) reloads the list', async () => {
      const error = vi.spyOn(TestBed.inject(NzMessageService), 'error');
      await selectOldest();

      press('Restore this version');
      await confirm();
      (await vi.waitFor(() => http.expectOne(`${NOTES}/n1/revisions/r1/restore`))).flush({}, { status: 409, statusText: 'Conflict' });

      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      await showList(); // the list is asked for again
      expect(rows()).toHaveLength(2);
    });
  });
});
