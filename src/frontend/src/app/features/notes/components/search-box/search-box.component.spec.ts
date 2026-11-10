import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideUi } from '../../../../core/ui.providers';
import { SearchBoxComponent } from './search-box.component';

describe('SearchBoxComponent', () => {
  let fixture: ComponentFixture<SearchBoxComponent>;
  let typed: string[];
  let cleared: number;
  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector<HTMLInputElement>('input[type="search"]')!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SearchBoxComponent], providers: [provideUi()] }).compileComponents();
    fixture = TestBed.createComponent(SearchBoxComponent);
    typed = [];
    cleared = 0;
    fixture.componentInstance.valueChange.subscribe((v) => typed.push(v));
    fixture.componentInstance.cleared.subscribe(() => cleared++);
    fixture.detectChanges();
  });

  function setValue(value: string) {
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
  }

  it('shows the value it is given, with an accessible label and the length limit of the server', () => {
    setValue('hello');

    expect(input().value).toBe('hello');
    expect(input().getAttribute('aria-label')).toBe('Search notes');
    expect(input().maxLength).toBe(100);
  });

  it('reports what the user types (it does not decide anything about it)', () => {
    input().value = 'xin chào';
    input().dispatchEvent(new Event('input'));

    expect(typed).toEqual(['xin chào']);
  });

  it('offers the x button only when there is text, and it reports "cleared"', () => {
    expect(el().querySelector('button')).toBeNull();

    setValue('abc');
    el().querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();

    expect(cleared).toBe(1);
  });

  it('Escape reports "cleared"', () => {
    setValue('abc');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(cleared).toBe(1);
  });

  it('explains that one letter is too short, and says nothing for empty or long enough text', () => {
    setValue('a');
    expect(el().querySelector('.search__hint')!.textContent).toContain('at least 2');

    setValue('  a ');
    expect(el().querySelector('.search__hint')).not.toBeNull(); // spaces do not count

    setValue('');
    expect(el().querySelector('.search__hint')).toBeNull();

    setValue('ab');
    expect(el().querySelector('.search__hint')).toBeNull();
  });
});
