import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideUi } from '../../../../core/ui.providers';
import { NoteOrganization, NoteStatus } from '../../models/note.model';
import { NotebookOption, Tag } from '../../models/organization.model';
import { NoteOrganizationComponent } from './note-organization.component';

const NOTEBOOKS: NotebookOption[] = [
  { notebook: { id: 'nb1', name: 'Work', parentId: null }, depth: 0, path: 'Work' },
];
const TAGS: Tag[] = [
  { id: 't1', name: 'urgent' },
  { id: 't2', name: 'idea' },
];

describe('NoteOrganizationComponent', () => {
  let fixture: ComponentFixture<NoteOrganizationComponent>;
  let emitted: NoteOrganization[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoteOrganizationComponent],
      providers: [provideUi()],
    }).compileComponents();
    fixture = TestBed.createComponent(NoteOrganizationComponent);
    emitted = [];
    fixture.componentInstance.changed.subscribe((c) => emitted.push(c));
  });

  function show(inputs: {
    notebookId?: string | null;
    isPinned?: boolean;
    status?: NoteStatus;
    tagIds?: string[];
    disabled?: boolean;
  }) {
    const ref = fixture.componentRef;
    ref.setInput('notebookId', inputs.notebookId ?? null);
    ref.setInput('isPinned', inputs.isPinned ?? false);
    ref.setInput('status', inputs.status ?? 'None');
    ref.setInput('tagIds', inputs.tagIds ?? []);
    ref.setInput('notebooks', NOTEBOOKS);
    ref.setInput('tags', TAGS);
    ref.setInput('disabled', inputs.disabled ?? false);
    fixture.detectChanges();
  }

  const pin = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.pin-btn')!;

  it('pinning emits the complete new organization (everything else unchanged)', () => {
    show({ notebookId: 'nb1', tagIds: ['t1'] });

    pin().click();

    expect(emitted).toEqual([{ notebookId: 'nb1', isPinned: true, status: 'None', tagIds: ['t1'] }]);
  });

  it('a pinned note offers to unpin it', () => {
    show({ isPinned: true });

    expect(pin().getAttribute('aria-label')).toBe('Unpin note');
    pin().click();
    expect(emitted[0].isPinned).toBe(false);
  });

  it('drops tag ids that no longer exist instead of sending them back (the server would answer 400)', () => {
    show({ tagIds: ['t2', 'deleted-tag'] });

    pin().click();

    expect(emitted[0].tagIds).toEqual(['t2']);
  });

  it('changing the status emits it together with everything else, and keeps the current status when pinning', async () => {
    show({ notebookId: 'nb1', status: 'Active', tagIds: ['t1'] });

    pin().click();
    expect(emitted[0]).toEqual({ notebookId: 'nb1', isPinned: true, status: 'Active', tagIds: ['t1'] });

    (fixture.componentInstance as unknown as { setStatus(s: NoteStatus | null): void }).setStatus('Completed');
    expect(emitted[1]).toEqual({ notebookId: 'nb1', isPinned: false, status: 'Completed', tagIds: ['t1'] });
  });

  it('clearing the status goes back to None', () => {
    show({ status: 'Dropped' });

    (fixture.componentInstance as unknown as { setStatus(s: NoteStatus | null): void }).setStatus(null);

    expect(emitted[0].status).toBe('None');
  });

  it('offers the notebook and tag pickers with a search box, and a status picker', () => {
    show({});
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.org__notebook.ant-select-show-search')).not.toBeNull();
    expect(html.querySelector('.org__tags.ant-select-multiple')).not.toBeNull();
    expect(html.querySelector('.org__status')).not.toBeNull();
  });

  it('cannot be used while disabled (a save is running)', () => {
    show({ disabled: true });

    expect(pin().disabled).toBe(true);
  });
});
