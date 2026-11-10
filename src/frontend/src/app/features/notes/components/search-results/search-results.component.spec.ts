import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideUi } from '../../../../core/ui.providers';
import { NotebookOption, Tag } from '../../models/organization.model';
import { SearchResult } from '../../models/search.model';
import { SearchResultsComponent } from './search-results.component';

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  id: 'n1',
  title: [
    { text: 'Xin ', match: false },
    { text: 'chào', match: true },
  ],
  snippet: [
    { text: '…', match: false },
    { text: 'đường', match: true },
    { text: ' Đồng Khởi', match: false },
  ],
  updatedAt: '2026-01-01T00:00:00Z',
  notebookId: null,
  isPinned: false,
  status: 'None',
  tagIds: [],
  ...over,
});

const NOTEBOOKS: NotebookOption[] = [{ notebook: { id: 'w', name: 'Projects', parentId: null }, depth: 1, path: 'Work / Projects' }];
const TAGS: Tag[] = [
  { id: 't1', name: 'urgent' },
  { id: 't2', name: 'idea' },
];

describe('SearchResultsComponent', () => {
  let fixture: ComponentFixture<SearchResultsComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchResultsComponent],
      providers: [provideRouter([]), provideUi()],
    }).compileComponents();
    fixture = TestBed.createComponent(SearchResultsComponent);
  });

  function show(inputs: Record<string, unknown>) {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  it('marks the matching words of the title and the snippet with <mark> and keeps the accents', () => {
    show({ results: [result()], total: 1 });

    const marks = Array.from(el().querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['chào', 'đường']);
    expect(el().querySelector('.item__title')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Xin chào');
  });

  it('links each result to its note and keeps ?q= and ?tag= so the results stay while reading', () => {
    show({ results: [result({ id: 'abc' })], total: 1 });

    expect(el().querySelector('a')!.getAttribute('href')).toBe('/notes/abc');
  });

  it('shows text that looks like HTML as plain text (no markup is created)', () => {
    show({
      results: [
        result({
          title: [{ text: '<img src=x onerror=alert(1)>', match: false }],
          snippet: [
            { text: '<script>alert(2)</script> ', match: false },
            { text: 'hack', match: true },
          ],
        }),
      ],
      total: 1,
    });

    expect(el().querySelector('img')).toBeNull();
    expect(el().querySelector('script')).toBeNull();
    expect(el().querySelector('.item__title')!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el().querySelector('.item__snippet')!.textContent).toContain('<script>alert(2)</script>');
  });

  it('counts the results (singular and plural)', () => {
    show({ results: [result()], total: 1 });
    expect(el().querySelector('.count')!.textContent).toBe('1 result');

    show({ results: [result(), result({ id: 'n2' })], total: 37 });
    expect(el().querySelector('.count')!.textContent).toBe('37 results');
  });

  it('shows where the note lives, its status and its tag names', () => {
    show({
      results: [result({ notebookId: 'w', status: 'OnHold', tagIds: ['t1', 't2'] })],
      total: 1,
      notebooks: NOTEBOOKS,
      tags: TAGS,
    });

    expect(el().querySelector('.item__path')!.textContent).toBe('Work / Projects');
    expect(el().querySelector('.chip--status')!.textContent!.trim()).toBe('On hold');
    expect(Array.from(el().querySelectorAll('.chip--tag')).map((c) => c.textContent!.trim())).toEqual(['idea', 'urgent']);
  });

  it('draws no meta line for a loose note without status and tags', () => {
    show({ results: [result()], total: 1, notebooks: NOTEBOOKS, tags: TAGS });

    expect(el().querySelector('.item__meta')).toBeNull();
  });

  it('says so when nothing matches, quoting the query', () => {
    show({ results: [], total: 0, query: 'zzz' });

    expect(el().textContent).toContain('No note matches "zzz"');
  });

  it('shows a spinner for the first load and an error when the search failed', () => {
    show({ results: [], loading: true });
    expect(el().querySelector('nz-spin')).not.toBeNull();

    show({ loading: false, failed: true });
    expect(el().querySelector('[role="alert"]')!.textContent).toContain('search failed');
  });

  it('offers "Show more" only when there is more, and asks for it', () => {
    const asked: number[] = [];
    fixture.componentInstance.showMore.subscribe(() => asked.push(1));
    show({ results: [result()], total: 5, hasMore: false });
    expect(el().querySelector('.more')).toBeNull();

    show({ hasMore: true });
    el().querySelector<HTMLButtonElement>('.more')!.click();

    expect(asked).toEqual([1]);
  });

  it('disables the button while the next page loads', () => {
    show({ results: [result()], total: 5, hasMore: true, loadingMore: true });

    const button = el().querySelector<HTMLButtonElement>('.more')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Loading');
  });
});
