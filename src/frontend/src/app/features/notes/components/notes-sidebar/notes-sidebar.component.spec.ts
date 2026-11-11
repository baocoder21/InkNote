import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { API_BASE_URL } from '../../../../core/api.config';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { NzModalService } from 'ng-zorro-antd/modal';
import { HARD_NAVIGATE } from '../../../../core/page-navigation';
import { ThemeService } from '../../../../core/theme.service';
import { provideUi } from '../../../../core/ui.providers';
import { AUTH_URL } from '../../../auth/services/auth-api.service';
import { AuthStore } from '../../../auth/store/auth.store';
import { LocalNote, LocalDbService, OutboxOp } from '../../../sync/local/local-db';
import { LocalSession } from '../../../sync/local-session.service';
import { SyncEngine } from '../../../sync/sync-engine.service';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { NotesSidebarComponent, SEARCH_DEBOUNCE_MS } from './notes-sidebar.component';

const NOTES = `${API_BASE_URL}/api/notes`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (id: string, title: string, notebookId: string | null, extra: Partial<LocalNote> = {}): LocalNote => ({
  id,
  title,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId,
  isPinned: false,
  status: 'None',
  tagIds: [],
  ...extra,
});

let dbCounter = 0;

describe('NotesSidebarComponent', () => {
  const hardNavigations: string[] = [];
  let fixture: ComponentFixture<NotesSidebarComponent>;
  let http: HttpTestingController;
  let local: LocalDbService;
  const ops = (): Promise<OutboxOp[]> => local.db.outbox.orderBy('seq').toArray();
  const el = () => fixture.nativeElement as HTMLElement;
  const rowNames = () =>
    Array.from(el().querySelectorAll('app-explorer-tree .row')).map(
      (r) => (r.classList.contains('row--folder') ? '[F] ' : '[N] ') + r.querySelector('.row__name')!.textContent,
    );
  const row = (name: string) =>
    Array.from(el().querySelectorAll<HTMLElement>('app-explorer-tree .row')).find(
      (r) => r.querySelector('.row__name')!.textContent === name,
    )!;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear(); // the open folders are remembered there
    hardNavigations.length = 0;
    await TestBed.configureTestingModule({
      imports: [NotesSidebarComponent],
      // A catch-all route so that navigating to /notes/<id> in the tests does not fail.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        provideUi(),
        NzModalService,
        NzContextMenuService,
        { provide: HARD_NAVIGATE, useValue: (url: string) => hardNavigations.push(url) },
        { provide: SEARCH_DEBOUNCE_MS, useValue: 80 }, // shorter than the real 250 ms, long enough not to be flaky
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    local = TestBed.inject(LocalDbService);
    await local.open(`sidebar-${++dbCounter}`); // the database of this device; the engine is not started here
    fixture = TestBed.createComponent(NotesSidebarComponent);

    // What the synchronization would have downloaded earlier.
    await local.db.notes.bulkPut([
      summary('n1', 'Plan', 'w', { tagIds: ['t1'] }),
      summary('n2', 'Roadmap', 'p'),
      summary('n3', 'Loose', null, { status: 'Active', tagIds: ['t2'] }),
    ]);
    await local.db.contents.bulkPut(['n1', 'n2', 'n3'].map((id) => ({ id, content: '' })));
    await local.db.notebooks.bulkPut([
      { id: 'w', name: 'Work', parentId: null, version: 1 },
      { id: 'p', name: 'Projects', parentId: 'w', version: 1 },
    ]);
    await local.db.tags.bulkPut([
      { id: 't1', name: 'idea', version: 1 },
      { id: 't2', name: 'urgent', version: 1 },
    ]);

    // The notes page loads the stores; here we do it ourselves.
    await Promise.all([TestBed.inject(NotesStore).loadNotes(), TestBed.inject(OrganizationStore).load()]);
    await settle();
  });

  afterEach(async () => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = '')); // close leftover dialogs
    await local.wipe();
  });

  const clickTool = async (label: string) => {
    el().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    await settle();
  };

  /** Types into the open name dialog and submits it (the dialog lives in an overlay). */
  async function fillDialog(text: string) {
    await vi.waitFor(() => expect(document.querySelector('app-name-dialog input')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('app-name-dialog input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await sleep(0);
    document.querySelector<HTMLFormElement>('app-name-dialog form')!.dispatchEvent(new Event('submit'));
  }

  const expectRequest = async (url: string) => {
    let request!: ReturnType<HttpTestingController['expectOne']>;
    await vi.waitFor(() => {
      request = http.expectOne(url);
    });
    return request;
  };

  it('shows ONE sidebar: tool icons, the folder tree (folders collapsed) and the tags', () => {
    expect(rowNames()).toEqual(['[F] Work', '[N] Loose']);
    expect(el().querySelector('button[aria-label="New note"]')).not.toBeNull();
    expect(el().querySelector('button[aria-label="New folder"]')).not.toBeNull();
    const tagNames = Array.from(el().querySelectorAll('.tag__name')).map((e) => e.textContent);
    expect(tagNames).toEqual(['idea', 'urgent']);
  });

  it('the theme button lists Light, Dark and Warm, marks the current one and switches on click', async () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');

    el().querySelector<HTMLButtonElement>('button[aria-label="Change theme"]')!.click();
    await settle();

    const items = () => Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li[nz-menu-item]'));
    // The click-triggered dropdown opens after a short delay of its own: wait for it.
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    expect(items().map((i) => i.textContent!.trim())).toEqual(['Light', 'Dark', 'Warm']);
    expect(items().filter((i) => i.querySelector('.check')).map((i) => i.textContent!.trim())).toEqual(['Dark']);

    items().find((i) => i.textContent!.includes('Warm'))!.click();
    await settle();

    expect(theme.theme()).toBe('warm');
    expect(document.documentElement.getAttribute('data-theme')).toBe('warm');
  });

  it('clicking a folder opens it, makes it the current folder, and remembers it for the next visit', async () => {
    row('Work').click();
    await settle();

    expect(rowNames()).toEqual(['[F] Work', '[F] Projects', '[N] Plan', '[N] Loose']);
    expect(row('Work').classList).toContain('row--current');
    expect(JSON.parse(localStorage.getItem('inknote.expandedFolders')!)).toEqual(['w']);

    row('Work').click(); // again: closes it
    await settle();
    expect(rowNames()).toEqual(['[F] Work', '[N] Loose']);
  });

  it('starts with the folders that were open last time', async () => {
    localStorage.setItem('inknote.expandedFolders', JSON.stringify(['w']));
    fixture = TestBed.createComponent(NotesSidebarComponent);
    await settle();

    expect(rowNames()).toContain('[N] Plan');
  });

  it('opening a note opens its folder and all the folders above it', async () => {
    await TestBed.inject(NotesStore).loadNote('n2'); // Roadmap, in Work / Projects
    await settle();

    expect(rowNames()).toEqual(['[F] Work', '[F] Projects', '[N] Roadmap', '[N] Plan', '[N] Loose']);
  });

  it('with a tag filter it lists only the notes with that tag, names the filter and can clear it', async () => {
    fixture.componentRef.setInput('tagId', 't1');
    await settle();

    expect(rowNames()).toEqual(['[N] Plan']);
    expect(el().querySelector('.filter')!.textContent).toContain('idea');
    expect(el().querySelector('a.filter__clear')!.getAttribute('href')).toBe('/notes');
    expect(el().querySelector('.tag--active')!.textContent).toContain('idea');
    expect(el().querySelector('a.tag__link')!.getAttribute('href')).toBe('/notes?tag=t1');
  });

  it('"New note" creates a loose note at once on this device (no waiting for the network) and queues it', async () => {
    await clickTool('New note');

    await vi.waitFor(() => expect(rowNames()).toContain('[N] Untitled'));
    const queued = (await ops()).filter((o) => o.entity === 'note');
    expect(queued).toHaveLength(1);
    // baseVersion null: a creation is not based on any version the server has.
    expect(queued[0]).toMatchObject({ kind: 'upsert', baseVersion: null, data: { title: 'Untitled', content: '' } });
    expect(queued[0].data?.['notebookId'] ?? null).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/notes/${queued[0].id}`); // and it is opened
  });

  it('"New note" creates the note inside the current folder and opens that folder', async () => {
    row('Work').click(); // makes Work the current folder
    await settle();

    await clickTool('New note');

    await vi.waitFor(() => expect(rowNames()).toContain('[N] Untitled'));
    const queued = (await ops()).filter((o) => o.entity === 'note');
    expect(queued[0].data).toMatchObject({ notebookId: 'w' });
  });

  it('"New folder" creates a sub-folder of the current folder through the dialog', async () => {
    row('Work').click();
    await settle();

    await clickTool('New folder');
    await fillDialog('Archive');

    await vi.waitFor(() => expect(rowNames()).toContain('[F] Archive'));
    expect((await ops()).filter((o) => o.entity === 'notebook')).toMatchObject([
      { kind: 'upsert', data: { name: 'Archive', parentId: 'w' } },
    ]);
  });

  it('"New tag…" creates a tag through the dialog and lists it sorted by name', async () => {
    el().querySelector<HTMLButtonElement>('.tag-new')!.click();
    await settle();
    await fillDialog('later');

    await vi.waitFor(() => {
      fixture.detectChanges();
      const tagNames = Array.from(el().querySelectorAll('.tag__name')).map((e) => e.textContent);
      expect(tagNames).toEqual(['idea', 'later', 'urgent']);
    });
    expect((await ops()).filter((o) => o.entity === 'tag')).toMatchObject([{ kind: 'upsert', data: { name: 'later' } }]);
  });

  it('pins a note from its menu, on this device, and queues only the pin on top of the version the list has', async () => {
    row('Work').click();
    await settle();

    row('Plan').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await sleep(20);
    const pin = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li')).find((i) =>
      i.textContent!.includes('Pin to top'),
    )!;
    pin.click();

    await vi.waitFor(async () => expect((await local.db.notes.get('n1'))?.isPinned).toBe(true));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(row('Plan').querySelector('.row__pin')).not.toBeNull();
    });
    expect(await ops()).toMatchObject([{ entity: 'note', id: 'n1', kind: 'upsert', baseVersion: 1, data: { isPinned: true } }]);
    expect(rowNames()).toEqual(['[F] Work', '[F] Projects', '[N] Plan', '[N] Loose']);
  });

  it('has a link to the Import & export page, under Trash', () => {
    const link = Array.from(el().querySelectorAll<HTMLAnchorElement>('a.trash-link')).find((a) => a.textContent!.includes('Import & export'))!;

    expect(link.getAttribute('href')).toBe('/notes/transfer');
  });

  it('"Export" in the menu of a note saves that note as a Markdown file', async () => {
    const saved: { href: string; download: string }[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.href, download: this.download });
    });
    row('Work').click();
    await settle();

    row('Plan').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await sleep(20);
    Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li'))
      .find((i) => i.textContent!.includes('Export'))!
      .click();

    await vi.waitFor(() => expect(saved).toEqual([{ href: 'blob:fake', download: 'Plan.md' }]));
  });

  it('each note row shows its status and its tag names (looked up from the tag list)', () => {
    const chips = (selector: string) =>
      Array.from(row('Loose').querySelectorAll(selector)).map((e) => e.textContent!.trim());

    expect(chips('.chip--status')).toEqual(['Active']);
    expect(chips('.chip--tag')).toEqual(['urgent']); // t2 = "urgent"
  });

  it('Rename on a note opens it and asks the editor to focus its title', async () => {
    const store = TestBed.inject(NotesStore);
    const router = TestBed.inject(Router);

    row('Loose').querySelector<HTMLButtonElement>('.row__btn[title="Rename"]')!.click();
    await settle();

    expect(store.titleFocusFor()).toBe('n3');
    expect(router.url).toBe('/notes/n3');
  });

  describe('synchronization status and signing out', () => {
    const signOutButton = () => el().querySelector<HTMLButtonElement>('button[aria-label="Sign out"]')!;
    let wipe: ReturnType<typeof vi.spyOn>;

    async function signIn() {
      const login = TestBed.inject(AuthStore).login({ email: 'ann@example.com', password: 'whatever whatever', rememberMe: false });
      http.expectOne(`${AUTH_URL}/login`).flush({ accessToken: 't', expiresInSeconds: 900, user: { id: 'u1', email: 'ann@example.com' } });
      await login;
      await settle();
    }

    beforeEach(() => {
      // The real wipe would delete the database this test still uses; what matters is that it is called.
      wipe = vi.spyOn(TestBed.inject(LocalSession), 'wipe').mockResolvedValue();
    });

    it('shows the synchronization status, and pressing it synchronizes now', async () => {
      const syncNow = vi.spyOn(TestBed.inject(SyncEngine), 'syncNow').mockResolvedValue();

      const button = el().querySelector<HTMLButtonElement>('app-sync-status button')!;
      expect(button).not.toBeNull();
      button.click();

      expect(syncNow).toHaveBeenCalledTimes(1);
    });

    it('shows who is signed in and signs out from the account row: the data of this device goes too', async () => {
      const engine = TestBed.inject(SyncEngine);
      vi.spyOn(engine, 'syncNow').mockResolvedValue();
      vi.spyOn(engine, 'pendingCount').mockResolvedValue(0);
      expect(el().querySelector('.account')).toBeNull(); // nobody signed in

      await signIn();
      expect(el().querySelector('.account__email')!.textContent).toContain('ann@example.com');

      signOutButton().click();
      await vi.waitFor(() => http.expectOne(`${AUTH_URL}/logout`).flush(null, { status: 204, statusText: 'No Content' }));
      await vi.waitFor(() => expect(hardNavigations).toEqual(['/login']));

      expect(wipe).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(AuthStore).isSignedIn()).toBe(false);
    });

    it('tries to send what is waiting before it signs out', async () => {
      const engine = TestBed.inject(SyncEngine);
      const order: string[] = [];
      vi.spyOn(engine, 'syncNow').mockImplementation(async () => void order.push('sync'));
      vi.spyOn(engine, 'pendingCount').mockImplementation(async () => (order.push('count'), 0));
      wipe.mockImplementation(async () => void order.push('wipe'));
      await signIn();

      signOutButton().click();
      await vi.waitFor(() => http.expectOne(`${AUTH_URL}/logout`).flush(null, { status: 204, statusText: 'No Content' }));

      expect(order).toEqual(['sync', 'count', 'wipe']);
    });

    it('with changes that could not be sent it asks first, and signing out is not done until the user agrees', async () => {
      const engine = TestBed.inject(SyncEngine);
      vi.spyOn(engine, 'syncNow').mockResolvedValue();
      vi.spyOn(engine, 'pendingCount').mockResolvedValue(2);
      await signIn();

      signOutButton().click();
      await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
      expect(document.querySelector('.ant-modal-confirm')!.textContent).toContain('2 changes have not reached the server');
      expect(wipe).not.toHaveBeenCalled();
      http.expectNone(`${AUTH_URL}/logout`);

      document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-dangerous')!.click();
      await vi.waitFor(() => http.expectOne(`${AUTH_URL}/logout`).flush(null, { status: 204, statusText: 'No Content' }));

      expect(wipe).toHaveBeenCalledTimes(1);
    });

    it('Cancel keeps the user signed in and the data on the device', async () => {
      const engine = TestBed.inject(SyncEngine);
      vi.spyOn(engine, 'syncNow').mockResolvedValue();
      vi.spyOn(engine, 'pendingCount').mockResolvedValue(1);
      await signIn();

      signOutButton().click();
      await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
      expect(document.querySelector('.ant-modal-confirm')!.textContent).toContain('1 change has not');

      // The first button of the dialog is Cancel (the dangerous one is "Sign out and lose them").
      document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns button:not(.ant-btn-dangerous)')!.click();
      await sleep(50);

      expect(wipe).not.toHaveBeenCalled();
      expect(TestBed.inject(AuthStore).isSignedIn()).toBe(true);
    });
  });

  describe('when the list is empty', () => {
    const emptyMessage = () => el().querySelector('.state')?.textContent?.trim();

    beforeEach(async () => {
      await local.db.notes.clear();
      await local.db.notebooks.clear();
      await vi.waitFor(() => expect(TestBed.inject(NotesStore).notes()).toEqual([]));
      await vi.waitFor(() => expect(TestBed.inject(OrganizationStore).notebooks()).toEqual([]));
      await settle();
    });

    it('before the first download it says the notes are loading, or that a connection is needed when offline', async () => {
      const engine = TestBed.inject(SyncEngine);

      expect(emptyMessage()).toBe('Loading your notes...');

      engine.state.set('offline');
      await settle();
      expect(emptyMessage()).toBe('Connect to the internet once to download your notes.');
    });

    it('after the first download it invites the user to create something', async () => {
      TestBed.inject(SyncEngine).initialSyncDone.set(true);
      await settle();

      expect(emptyMessage()).toContain('Nothing here yet');
    });
  });

  it('deletes a note after the user confirms', async () => {
    row('Work').click();
    await settle();

    row('Plan').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await sleep(20);
    Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li'))
      .find((i) => i.textContent!.includes('Delete note'))!
      .click();
    await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm')).not.toBeNull());
    expect(await local.db.notes.get('n1')).toBeDefined(); // nothing is deleted before the user confirms

    document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-dangerous')!.click();

    // The deletion happens on this device and is queued; the list does not wait for the server.
    await vi.waitFor(async () => expect(await local.db.notes.get('n1')).toBeUndefined());
    expect(await ops()).toMatchObject([{ entity: 'note', id: 'n1', kind: 'delete', baseVersion: 1 }]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(rowNames()).not.toContain('[N] Plan');
    });

    // The note goes to the trash on the server: the sidebar asks for the trash again and shows the count.
    (await expectRequest(`${NOTES}/trash`)).flush([summary('n1', 'Plan', 'w')]);
    await sleep(0);
    await settle();
    expect(el().querySelector('.trash-link__count')!.textContent!.trim()).toBe('1');
  });

  describe('search', () => {
    const SEARCH = `${NOTES}/search`;
    const box = () => el().querySelector<HTMLInputElement>('input[type="search"]')!;
    const hit = (id: string, title: string) => ({
      id,
      title: [{ text: title, match: false }],
      snippet: [{ text: 'a snippet', match: false }],
      updatedAt: '2026-01-01T00:00:00Z',
      notebookId: null,
      isPinned: false,
      status: 'None',
      tagIds: [],
    });
    const expectSearch = (q: string) =>
      vi.waitFor(() => http.expectOne((r) => r.url === SEARCH && r.params.get('q') === q));

    async function type(text: string) {
      box().value = text;
      box().dispatchEvent(new Event('input'));
      await settle();
    }

    /** What the notes page does: the URL changed, so the new ?q= is handed down. */
    async function urlSays(q: string | null) {
      fixture.componentRef.setInput('q', q);
      await settle();
    }

    it('has a search box, and the folder tree stays while the box is empty', () => {
      expect(box()).not.toBeNull();
      expect(el().querySelector('app-search-results')).toBeNull();
      expect(rowNames().length).toBeGreaterThan(0);
    });

    it('waits for a pause in the typing, then writes ?q= to the URL (once, not per letter)', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate');

      // Three keystrokes in a row, with no time in between (a fast typist).
      for (const text of ['h', 'he', 'hello']) {
        box().value = text;
        box().dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled(); // still inside the pause

      await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { q: 'hello' }, replaceUrl: true });
      await vi.waitFor(() => expect(router.url).toContain('q=hello'));
    });

    it('searches what the URL says and shows the results instead of the tree', async () => {
      await urlSays('hello');
      (await expectSearch('hello')).flush({ items: [hit('n1', 'Hello world')], total: 1, page: 1, pageSize: 20 });
      await settle();

      expect(el().querySelector('app-search-results')).not.toBeNull();
      expect(el().querySelector('app-explorer-tree')).toBeNull(); // the tree is hidden while searching
      expect(el().querySelector('.item__title')!.textContent).toContain('Hello world');
    });

    it('one letter is not searched: a hint is shown and the tree stays', async () => {
      await type('h');

      expect(el().querySelector('.search__hint')!.textContent).toContain('at least 2');
      http.expectNone((r) => r.url === SEARCH);
      expect(el().querySelector('app-search-results')).toBeNull();
    });

    it('the x button and Escape empty the box and bring the tree back at once', async () => {
      await urlSays('hello');
      (await expectSearch('hello')).flush({ items: [hit('n1', 'Hello')], total: 1, page: 1, pageSize: 20 });
      await settle();
      expect(box().value).toBe('hello');

      el().querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
      await settle();
      expect(box().value).toBe('');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).not.toContain('q='));
      await urlSays(null);
      expect(el().querySelector('app-search-results')).toBeNull();
      expect(el().querySelector('app-explorer-tree')).not.toBeNull();

      await type('again');
      box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(box().value).toBe('');
    });

    it('the box follows the URL when it changes from outside (Back button, a link)', async () => {
      await urlSays('from the url');
      (await expectSearch('from the url')).flush({ items: [], total: 0, page: 1, pageSize: 20 });
      await settle();

      expect(box().value).toBe('from the url');
      expect(el().textContent).toContain('No note matches "from the url"');
    });

    it('does not overwrite what the user typed when its own earlier text comes back from the URL', async () => {
      await type('hel');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('q=hel'));
      await type('hello'); // typed while the first navigation is still being handed down

      await urlSays('hel'); // the page now reports the OLD text
      (await expectSearch('hel')).flush({ items: [], total: 0, page: 1, pageSize: 20 });
      await settle();

      expect(box().value).toBe('hello');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('q=hello'));
    });

    it('searches inside a tag when a tag filter is on', async () => {
      fixture.componentRef.setInput('tagId', 't1');
      await urlSays('hello');

      const request = await vi.waitFor(() => http.expectOne((r) => r.url === SEARCH && r.params.get('tagId') === 't1'));
      request.flush({ items: [], total: 0, page: 1, pageSize: 20 });
      await settle();
    });

    it('"Show more" loads the next page and adds it to the list', async () => {
      await urlSays('hello');
      (await expectSearch('hello')).flush({ items: [hit('n1', 'First')], total: 2, page: 1, pageSize: 1 });
      await settle();

      el().querySelector<HTMLButtonElement>('.more')!.click();
      const second = await vi.waitFor(() => http.expectOne((r) => r.url === SEARCH && r.params.get('page') === '2'));
      second.flush({ items: [hit('n2', 'Second')], total: 2, page: 2, pageSize: 1 });
      await settle();

      expect(Array.from(el().querySelectorAll('.item__title')).map((t) => t.textContent!.trim())).toEqual(['First', 'Second']);
      expect(el().querySelector('.more')).toBeNull();
    });
  });
});
