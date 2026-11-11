import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { API_BASE_URL } from '../../../../core/api.config';
import { provideUi } from '../../../../core/ui.providers';
import { AuthStore } from '../../../auth/store/auth.store';
import { LocalDbService } from '../../../sync/local/local-db';
import { LocalSession } from '../../../sync/local-session.service';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncEngine } from '../../../sync/sync-engine.service';
import { NotesStore } from '../../store/notes.store';
import { NotesPageComponent } from './notes-page.component';

const TRASH = `${API_BASE_URL}/api/notes/trash`;
let counter = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('NotesPageComponent', () => {
  let fixture: ComponentFixture<NotesPageComponent>;
  let http: HttpTestingController;
  let local: LocalDbService;
  let engine: SyncEngine;
  let user: ReturnType<typeof signal<{ id: string; email: string } | null>>;
  let begin: ReturnType<typeof vi.fn>;

  const answerTrash = () => http.match(TRASH).forEach((r) => r.flush([]));

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    user = signal<{ id: string; email: string } | null>({ id: `page-user-${++counter}`, email: 'ann@example.com' });
    // The real LocalSession would also start the synchronization (network); this test is about the page.
    begin = vi.fn(async (id: string) => void (await TestBed.inject(LocalDbService).open(id)));
    await TestBed.configureTestingModule({
      imports: [NotesPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideUi(),
        NzModalService,
        NzContextMenuService,
        { provide: AuthStore, useValue: { user, isSignedIn: () => true } },
        { provide: LocalSession, useValue: { begin, end: vi.fn(), wipe: vi.fn() } },
        { provide: SYNC_DEBOUNCE_MS, useValue: 60 },
        { provide: SYNC_INTERVAL_MS, useValue: 0 },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    local = TestBed.inject(LocalDbService);
    engine = TestBed.inject(SyncEngine);
  });

  afterEach(async () => {
    answerTrash();
    http.verify();
    await local.wipe();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  async function show() {
    fixture = TestBed.createComponent(NotesPageComponent);
    await settle();
    await vi.waitFor(() => expect(local.openUserId()).not.toBeNull());
    await vi.waitFor(() => expect(TestBed.inject(NotesStore).loadingList()).toBe(false));
    await settle();
  }

  it('opens the database of the signed-in user, and shows the notes stored on this device without the network', async () => {
    const id = user()!.id;
    // Something the synchronization stored in an earlier visit: only the DATABASE has it.
    await (await local.open(id)).notes.put({
      id: 'n1', title: 'Stored here', createdAt: '', updatedAt: '', version: 1, notebookId: null, isPinned: false, status: 'None', tagIds: [],
    });

    await show();

    expect(begin).toHaveBeenCalledWith(id);
    await vi.waitFor(() => expect(TestBed.inject(NotesStore).notes().map((n) => n.title)).toEqual(['Stored here']));
  });

  it('asks the server only for the trash (the one thing that is not on this device)', async () => {
    await show();

    // The request is sent right after the list is read from this device: wait for it. expectOne also proves it is exactly ONE.
    await vi.waitFor(() => http.expectOne(TRASH).flush([]));
    http.expectNone((r) => r.url.endsWith('/api/notes')); // the list does not come from the server
  });

  it('creates the page inside (the editor...) only AFTER the database is open (a reload on /notes/<id> used to fail)', async () => {
    // The database opens "later": what the editor would have met on a reload.
    let finishOpening!: () => void;
    const opening = new Promise<void>((resolve) => (finishOpening = resolve));
    begin.mockImplementation(async (id: string) => {
      await opening;
      await TestBed.inject(LocalDbService).open(id);
    });

    fixture = TestBed.createComponent(NotesPageComponent);
    await settle();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull(); // not yet: nothing may read the database

    finishOpening();
    await vi.waitFor(() => expect(local.openUserId()).not.toBeNull());
    await settle();

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    answerTrash();
  });

  it('never shows the inside when the database cannot be opened', async () => {
    begin.mockRejectedValue(new Error('SecurityError'));
    vi.spyOn(TestBed.inject(NzMessageService), 'error');

    fixture = TestBed.createComponent(NotesPageComponent);
    await settle();
    await sleep(20);
    await settle();

    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
  });

  it('does nothing when nobody is signed in', async () => {
    user.set(null);

    fixture = TestBed.createComponent(NotesPageComponent);
    await settle();

    expect(begin).not.toHaveBeenCalled();
  });

  it('tells the user what the synchronization reports: a warning for conflicts, an error for rejected changes, then clears it', async () => {
    const message = TestBed.inject(NzMessageService);
    const warning = vi.spyOn(message, 'warning');
    const error = vi.spyOn(message, 'error');
    await show();
    await vi.waitFor(() => http.expectOne(TRASH).flush([])); // the first load

    engine.notices.set([
      { kind: 'conflict', message: 'Both devices edited "Plan"; the other text was kept as a revision.' },
      { kind: 'rejected', message: 'The folder is not empty.' },
    ]);
    await settle();

    expect(warning).toHaveBeenCalledWith('Both devices edited "Plan"; the other text was kept as a revision.', expect.anything());
    expect(error).toHaveBeenCalledWith('The folder is not empty.', expect.anything());
    expect(engine.notices()).toEqual([]);
  });

  it('reloads the trash when changes reached the server (a deletion puts a note there)', async () => {
    await show();
    await vi.waitFor(() => http.expectOne(TRASH).flush([])); // the first load

    engine.pushedCount.set(1);
    await settle();

    await vi.waitFor(() => http.expectOne(TRASH).flush([])); // and exactly one more
  });

  it('says so when the database of this browser cannot be opened (private browsing), and loads nothing', async () => {
    const message = TestBed.inject(NzMessageService);
    const error = vi.spyOn(message, 'error');
    begin.mockRejectedValue(new Error('SecurityError'));

    fixture = TestBed.createComponent(NotesPageComponent);
    await settle();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());

    expect(String(error.mock.calls[0][0])).toContain('Cannot open the database');
    http.expectNone(TRASH);
  });
});
