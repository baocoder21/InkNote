import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { provideUi } from '../ui.providers';
import { RELOAD_PAGE } from '../page-navigation';
import { UpdateNotifier } from '../update-notifier.service';
import { UpdateBannerComponent } from './update-banner.component';

describe('UpdateBannerComponent', () => {
  let fixture: ComponentFixture<UpdateBannerComponent>;
  let updates: UpdateNotifier;
  let versionUpdates: Subject<{ type: string }>;
  let unrecoverable: Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>;
  let activate: ReturnType<typeof vi.fn>;
  let reloaded: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el().querySelectorAll('button')).map((b) => b.textContent!.trim());
  const press = (label: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent!.trim() === label)!.click();
  const show = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    versionUpdates = new Subject();
    unrecoverable = new Subject();
    activate = vi.fn(async () => true);
    reloaded = 0;
    await TestBed.configureTestingModule({
      imports: [UpdateBannerComponent],
      providers: [
        provideUi(),
        { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, unrecoverable, checkForUpdate: vi.fn(async () => false), activateUpdate: activate } },
        { provide: RELOAD_PAGE, useValue: () => reloaded++ },
      ],
    }).compileComponents();
    updates = TestBed.inject(UpdateNotifier);
    updates.start();
    fixture = TestBed.createComponent(UpdateBannerComponent);
    await show();
  });

  it('shows nothing while the app is up to date', () => {
    expect(el().querySelector('.banner')).toBeNull();
  });

  it('says a new version is ready, with "Later" and "Reload"', async () => {
    versionUpdates.next({ type: 'VERSION_READY' });
    await show();

    expect(el().querySelector('.banner')!.textContent).toContain('A new version of InkNote is ready.');
    expect(buttons()).toEqual(['Later', 'Reload']);
    expect(el().querySelector('.banner')!.getAttribute('role')).toBe('status'); // read out by screen readers
  });

  it('"Later" hides it and reloads nothing', async () => {
    versionUpdates.next({ type: 'VERSION_READY' });
    await show();

    press('Later');
    await show();

    expect(el().querySelector('.banner')).toBeNull();
    expect(reloaded).toBe(0);
  });

  it('"Reload" activates the new version and reloads the page', async () => {
    versionUpdates.next({ type: 'VERSION_READY' });
    await show();

    press('Reload');
    await vi.waitFor(() => expect(reloaded).toBe(1));

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('when the cache is broken it asks for a reload and offers no "Later"', async () => {
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    await show();

    expect(el().querySelector('.banner')!.textContent).toContain('needs to reload');
    expect(buttons()).toEqual(['Reload']);
  });
});
