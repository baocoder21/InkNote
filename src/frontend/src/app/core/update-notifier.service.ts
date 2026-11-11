import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { RELOAD_PAGE } from './page-navigation';

/** How often to ask whether a newer version of the app exists (also done whenever the tab becomes visible). */
export const UPDATE_CHECK_MS = new InjectionToken<number>('UPDATE_CHECK_MS', { providedIn: 'root', factory: () => 30 * 60_000 });

/**
 * 'ready'  = a newer version has been downloaded in the background and waits for a reload;
 * 'broken' = the service worker lost track of its cache (for example the browser cleared part of it): the page
 *            may fail to load more files until it is reloaded.
 */
export type UpdateState = 'none' | 'ready' | 'broken';

/**
 * Knows when the installed app has a newer version, so the user can be told (see UpdateBannerComponent).
 *
 * How an update happens: the service worker compares `ngsw.json` (the hash of every file of the build) with the
 * one it has, downloads what changed IN THE BACKGROUND and reports "ready". The page keeps running the old version
 * until it is reloaded: swapping files under a running page would mix two versions. We never reload by ourselves,
 * because the user may be typing; whatever they typed is safe in the local database either way.
 *
 * Without a service worker (`ng serve`, tests, a browser without support) none of this exists and nothing happens.
 */
@Injectable({ providedIn: 'root' })
export class UpdateNotifier {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly document = inject(DOCUMENT);
  private readonly reloadPage = inject(RELOAD_PAGE);
  private readonly checkEveryMs = inject(UPDATE_CHECK_MS);

  readonly state = signal<UpdateState>('none');

  private started = false;

  /** Starts listening. Safe to call again. */
  start(): void {
    const sw = this.sw;
    if (this.started || !sw?.isEnabled) {
      return;
    }
    this.started = true;

    sw.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.state.set('ready');
      }
    });
    sw.unrecoverable.subscribe(() => this.state.set('broken'));

    // The service worker also checks by itself when the app starts; these cover an app that stays open for days.
    setInterval(() => this.check(), this.checkEveryMs);
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'visible') {
        this.check();
      }
    });
  }

  /** Switches to the downloaded version and reloads the page. */
  async reload(): Promise<void> {
    try {
      await this.sw?.activateUpdate();
    } catch {
      /* nothing to activate (or the worker is gone): a plain reload is still the right thing */
    }
    this.reloadPage();
  }

  /** "Later": hides the notice. The next newer version shows it again. A broken state cannot be dismissed. */
  dismiss(): void {
    if (this.state() === 'ready') {
      this.state.set('none');
    }
  }

  private check(): void {
    // Offline: the check fails, which is fine; the next one will do.
    this.sw?.checkForUpdate().catch(() => undefined);
  }
}
