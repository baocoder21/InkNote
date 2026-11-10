import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideUi } from '../../../../core/ui.providers';
import { SyncState } from '../../sync-engine.service';
import { SyncStatusComponent } from './sync-status.component';

describe('SyncStatusComponent', () => {
  let fixture: ComponentFixture<SyncStatusComponent>;
  const el = () => fixture.nativeElement as HTMLElement;
  const label = () => el().querySelector('.sync__label')!.textContent!.trim();
  const button = () => el().querySelector<HTMLButtonElement>('button')!;

  async function show(state: SyncState, pending = 0, lastSyncedAt: Date | null = null) {
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('pending', pending);
    fixture.componentRef.setInput('lastSyncedAt', lastSyncedAt);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SyncStatusComponent], providers: [provideUi()] }).compileComponents();
    fixture = TestBed.createComponent(SyncStatusComponent);
    fixture.componentRef.setInput('state', 'idle');
    fixture.detectChanges();
  });

  it('says everything is synchronized when idle and nothing waits', async () => {
    await show('idle');

    expect(label()).toBe('All changes synced');
    await vi.waitFor(() => expect(el().querySelector('nz-icon svg')?.getAttribute('data-icon')).toBe('check'));
  });

  it('counts the changes that are waiting (singular and plural)', async () => {
    await show('idle', 1);
    expect(label()).toBe('1 change waiting');

    await show('idle', 3);
    expect(label()).toBe('3 changes waiting');
  });

  it('shows "Syncing..." with a spinning icon while it runs', async () => {
    await show('syncing', 2);

    expect(label()).toBe('Syncing...');
    expect(el().querySelector('nz-icon')!.classList).toContain('anticon-spin');
  });

  it('offline is calm: it says so, with how much waits, and is not painted as an error', async () => {
    await show('offline');
    expect(label()).toBe('Offline');

    await show('offline', 2);
    expect(label()).toBe('Offline · 2 changes waiting');
    expect(button().classList).toContain('sync--offline');
    expect(button().classList).not.toContain('sync--error');
  });

  it('a problem is painted as an error and also counts what waits', async () => {
    await show('error', 1);

    expect(label()).toBe('Sync problem · 1 change waiting');
    expect(button().classList).toContain('sync--error');
  });

  it('pressing it asks for a synchronization', async () => {
    let pressed = 0;
    fixture.componentInstance.retry.subscribe(() => pressed++);

    button().click();

    expect(pressed).toBe(1);
  });

  it('tells assistive technology the state, and when it was last synchronized', async () => {
    await show('idle', 0, new Date('2026-03-04T10:00:00Z'));

    expect(button().getAttribute('aria-label')).toContain('All changes synced');
    expect(button().title).toContain('Last synchronized');
    expect(el().querySelector('.sync__label')!.getAttribute('role')).toBe('status');
  });
});
