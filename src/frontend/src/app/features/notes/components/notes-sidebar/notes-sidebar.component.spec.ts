import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { API_BASE_URL } from '../../../../core/api.config';
import { NzContextMenuService } from 'ng-zorro-antd/dropdown';
import { NzModalService } from 'ng-zorro-antd/modal';
import { ThemeService } from '../../../../core/theme.service';
import { provideUi } from '../../../../core/ui.providers';
import { NotesStore } from '../../store/notes.store';
import { OrganizationStore } from '../../store/organization.store';
import { NotesSidebarComponent } from './notes-sidebar.component';

const NOTES = `${API_BASE_URL}/api/notes`;
const NOTEBOOKS = `${API_BASE_URL}/api/notebooks`;
const TAGS = `${API_BASE_URL}/api/tags`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (id: string, title: string, notebookId: string | null, extra = {}) => ({
  id,
  title,
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
  notebookId,
  isPinned: false,
  status: 'None',
  tagIds: [] as string[],
  ...extra,
});

const FULL = (id: string, title: string, notebookId: string | null) => ({
  ...summary(id, title, notebookId),
  content: '',
  createdAt: '2026-01-01T00:00:00Z',
});

describe('NotesSidebarComponent', () => {
  let fixture: ComponentFixture<NotesSidebarComponent>;
  let http: HttpTestingController;
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
    await TestBed.configureTestingModule({
      imports: [NotesSidebarComponent],
      // A catch-all route so that navigating to /notes/<id> in the tests does not fail.
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }]), provideUi(), NzModalService, NzContextMenuService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(NotesSidebarComponent);

    // The notes page loads the stores; here we do it ourselves.
    const notes = TestBed.inject(NotesStore).loadNotes();
    const org = TestBed.inject(OrganizationStore).load();
    http.expectOne(NOTES).flush([
      summary('n1', 'Plan', 'w', { tagIds: ['t1'] }),
      summary('n2', 'Roadmap', 'p'),
      summary('n3', 'Loose', null),
    ]);
    http.expectOne(NOTEBOOKS).flush([
      { id: 'w', name: 'Work', parentId: null },
      { id: 'p', name: 'Projects', parentId: 'w' },
    ]);
    http.expectOne(TAGS).flush([
      { id: 't1', name: 'idea' },
      { id: 't2', name: 'urgent' },
    ]);
    await Promise.all([notes, org]);
    await settle();
  });

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = '')); // close leftover dialogs
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
    const opening = TestBed.inject(NotesStore).loadNote('n2'); // Roadmap, in Work / Projects
    http.expectOne(`${NOTES}/n2`).flush(FULL('n2', 'Roadmap', 'p'));
    await opening;
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

  it('"New note" creates a loose note when no folder is current', async () => {
    await clickTool('New note');

    const request = http.expectOne(NOTES);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'Untitled', content: '' });
    request.flush({ ...FULL('new', 'Untitled', null) });
    await settle();
    await sleep(0);

    expect(rowNames()).toContain('[N] Untitled');
  });

  it('"New note" creates the note inside the current folder and opens that folder', async () => {
    row('Work').click(); // makes Work the current folder
    await settle();

    await clickTool('New note');

    const request = http.expectOne(NOTES);
    expect(request.request.body).toEqual({ title: 'Untitled', content: '', notebookId: 'w' });
    request.flush(FULL('new', 'Untitled', 'w'));
    await settle();
    await sleep(0);

    expect(rowNames()).toContain('[N] Untitled');
  });

  it('"New folder" creates a sub-folder of the current folder through the dialog', async () => {
    row('Work').click();
    await settle();

    await clickTool('New folder');
    await fillDialog('Archive');

    const request = await expectRequest(NOTEBOOKS);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Archive', parentId: 'w' });
    request.flush({ id: 'a', name: 'Archive', parentId: 'w' });
    await sleep(0);
    await settle();

    expect(rowNames()).toContain('[F] Archive');
  });

  it('"New tag…" creates a tag through the dialog and lists it sorted by name', async () => {
    el().querySelector<HTMLButtonElement>('.tag-new')!.click();
    await settle();
    await fillDialog('later');

    const request = await expectRequest(TAGS);
    expect(request.request.body).toEqual({ name: 'later' });
    request.flush({ id: 't3', name: 'later' });
    await sleep(0);
    await settle();

    const tagNames = Array.from(el().querySelectorAll('.tag__name')).map((e) => e.textContent);
    expect(tagNames).toEqual(['idea', 'later', 'urgent']);
  });

  it('pins a note from its menu using the version the list already has', async () => {
    row('Work').click();
    await settle();

    row('Plan').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await sleep(20);
    const pin = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container li')).find((i) =>
      i.textContent!.includes('Pin to top'),
    )!;
    pin.click();

    const request = await expectRequest(`${NOTES}/n1/organization`);
    expect(request.request.body).toEqual({ notebookId: 'w', isPinned: true, status: 'None', tagIds: ['t1'], version: 1 });
    request.flush({ ...FULL('n1', 'Plan', 'w'), version: 2, isPinned: true, tagIds: ['t1'] });
    await sleep(0);
    await settle();

    expect(row('Plan').querySelector('.row__pin')).not.toBeNull();
    expect(rowNames()).toEqual(['[F] Work', '[F] Projects', '[N] Plan', '[N] Loose']);
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
    http.expectNone(`${NOTES}/n1`); // nothing is deleted before the user confirms

    document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-dangerous')!.click();

    const request = await expectRequest(`${NOTES}/n1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await sleep(0);
    await settle();

    expect(rowNames()).not.toContain('[N] Plan');
  });
});
