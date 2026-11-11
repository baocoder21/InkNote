import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { RELOAD_PAGE } from './page-navigation';
import { UPDATE_CHECK_MS, UpdateNotifier } from './update-notifier.service';

/** The few things of SwUpdate we use, driven by the test. */
function fakeSw(isEnabled = true) {
  return {
    isEnabled,
    versionUpdates: new Subject<{ type: string }>(),
    unrecoverable: new Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>(),
    checkForUpdate: vi.fn(async () => false),
    activateUpdate: vi.fn(async () => true),
  };
}

describe('UpdateNotifier', () => {
  let sw: ReturnType<typeof fakeSw>;
  let reloaded: number;
  let calls: string[];

  function create(options: { sw?: ReturnType<typeof fakeSw> | null; checkMs?: number } = {}) {
    sw = options.sw === null ? (null as never) : (options.sw ?? fakeSw());
    reloaded = 0;
    calls = [];
    TestBed.configureTestingModule({
      providers: [
        ...(sw ? [{ provide: SwUpdate, useValue: sw }] : []),
        { provide: RELOAD_PAGE, useValue: () => (reloaded++, calls.push('reload')) },
        { provide: UPDATE_CHECK_MS, useValue: options.checkMs ?? 60_000 },
      ],
    });
    return TestBed.inject(UpdateNotifier);
  }

  afterEach(() => vi.useRealTimers());

  it('starts with nothing to report', () => {
    const updates = create();
    updates.start();

    expect(updates.state()).toBe('none');
  });

  it('says "ready" when a newer version has been downloaded', () => {
    const updates = create();
    updates.start();

    sw.versionUpdates.next({ type: 'VERSION_READY' });

    expect(updates.state()).toBe('ready');
  });

  it('ignores the other version events (found, failed, nothing new)', () => {
    const updates = create();
    updates.start();

    sw.versionUpdates.next({ type: 'VERSION_DETECTED' });
    sw.versionUpdates.next({ type: 'VERSION_INSTALLATION_FAILED' });
    sw.versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED' });

    expect(updates.state()).toBe('none');
  });

  it('says "broken" when the service worker lost its cache, and that cannot be dismissed', () => {
    const updates = create();
    updates.start();

    sw.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    updates.dismiss();

    expect(updates.state()).toBe('broken');
  });

  it('"Later" hides the notice; the next newer version shows it again', () => {
    const updates = create();
    updates.start();
    sw.versionUpdates.next({ type: 'VERSION_READY' });

    updates.dismiss();
    expect(updates.state()).toBe('none');

    sw.versionUpdates.next({ type: 'VERSION_READY' });
    expect(updates.state()).toBe('ready');
  });

  it('reload switches to the downloaded version FIRST and only then reloads the page', async () => {
    const updates = create();
    updates.start();
    sw.activateUpdate.mockImplementation(async () => (calls.push('activate'), true));

    await updates.reload();

    expect(calls).toEqual(['activate', 'reload']);
  });

  it('reload still reloads when activating fails (the worker is gone)', async () => {
    const updates = create();
    updates.start();
    sw.activateUpdate.mockRejectedValue(new Error('no worker'));

    await updates.reload();

    expect(reloaded).toBe(1);
  });

  it('does nothing at all without a service worker (ng serve, tests, an old browser)', async () => {
    const updates = create({ sw: fakeSw(false) });

    updates.start();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(updates.state()).toBe('none');
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
  });

  it('works when the service worker is not provided at all', async () => {
    const updates = create({ sw: null });

    updates.start();
    await updates.reload();

    expect(updates.state()).toBe('none');
    expect(reloaded).toBe(1);
  });

  it('start() twice listens once', () => {
    const updates = create();
    updates.start();
    updates.start();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  describe('looking for a newer version', () => {
    it('asks again every so often, for an app that stays open for days', () => {
      vi.useFakeTimers();
      const updates = create({ checkMs: 1000 });
      updates.start();

      vi.advanceTimersByTime(3100);

      expect(sw.checkForUpdate).toHaveBeenCalledTimes(3);
    });

    it('asks when the tab becomes visible again, not when it is hidden', () => {
      const updates = create();
      updates.start();

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(sw.checkForUpdate).not.toHaveBeenCalled();

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
    });

    it('a failed check (offline) is not an error', async () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const updates = create();
      updates.start();
      sw.checkForUpdate.mockRejectedValue(new Error('offline'));

      document.dispatchEvent(new Event('visibilitychange')); // an unhandled rejection here would fail the test run
      await Promise.resolve();

      expect(updates.state()).toBe('none');
    });
  });
});
