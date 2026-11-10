import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { provideUi } from './core/ui.providers';

describe('App', () => {
  it('renders the application header', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideUi()],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.topbar')?.textContent).toContain(
      'InkNote',
    );
  });
});
