import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { API_BASE_URL } from '../../core/api.config';
import { AuthStore } from '../auth/store/auth.store';
import { expiresWithin } from './jwt-expiry';
import { SyncEngine } from './sync-engine.service';

/** The few things of a SignalR connection that we use (so that tests can replace it with a fake). */
export interface HubLike {
  on(method: string, handler: () => void): void;
  onclose(handler: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type RealtimeState = 'off' | 'connecting' | 'live' | 'reconnecting';

/** Where the hub lives. */
export const HUB_URL = new InjectionToken<string>('HUB_URL', { providedIn: 'root', factory: () => `${API_BASE_URL}/hubs/sync` });

/** Builds a connection. `token` is called every time one is made, so a reconnect never uses an expired token. */
export const HUB_FACTORY = new InjectionToken<(url: string, token: () => Promise<string>) => HubLike>('HUB_FACTORY', {
  providedIn: 'root',
  factory: () => (url, token) =>
    new HubConnectionBuilder()
      .withUrl(url, { accessTokenFactory: token })
      .configureLogging(LogLevel.None) // a lost connection is normal here: the state signal says it, no console noise
      .build(),
});

/** Pauses between attempts to connect again: short at first, then at most every 30 seconds. Tests shorten it. */
export const REALTIME_RETRY_MS = new InjectionToken<number[]>('REALTIME_RETRY_MS', {
  providedIn: 'root',
  factory: () => [500, 1000, 2000, 5000, 10_000, 30_000],
});

/** An access token with less than this left is renewed before it is used to connect. */
const TOKEN_MARGIN_MS = 30_000;

/**
 * The "doorbell": keeps a connection to the server's hub open. When the server says "changed" (some other device
 * saved something) it runs the normal synchronization at once instead of waiting for the 30 second timer.
 *
 * The message carries NO data, it only says "go and look". So:
 *  - a notification that is lost (the connection dropped) costs nothing: after every (re)connection one
 *    synchronization catches up on whatever was missed, and the timer still runs as a safety net;
 *  - there is still exactly one way for data to arrive on this device: the pull.
 *
 * Reconnecting is done here (not by SignalR's built-in option) so there is ONE mechanism: every attempt builds a
 * fresh connection with a fresh token, waits longer after each failure, and tries at once when the browser says
 * the network is back.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeSync {
  private readonly engine = inject(SyncEngine);
  private readonly auth = inject(AuthStore);
  private readonly document = inject(DOCUMENT);
  private readonly createHub = inject(HUB_FACTORY);
  private readonly url = inject(HUB_URL);
  private readonly retryDelays = inject(REALTIME_RETRY_MS);

  /** 'live' = connected (changes arrive at once); anything else = the timer is the only thing that syncs. */
  readonly state = signal<RealtimeState>('off');

  private hub: HubLike | null = null;
  // Changes at every start()/stop(). A connection attempt that finishes after that is out of date and gives up.
  private generation = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private removeListener: (() => void) | null = null;

  /** Connects (and keeps connecting). Call it once the user is signed in and the local database is open. */
  start(): void {
    this.stop();
    const generation = this.generation;

    const view = this.document.defaultView;
    if (view) {
      const online = () => this.retryNow(generation);
      view.addEventListener('online', online);
      this.removeListener = () => view.removeEventListener('online', online);
    }

    this.state.set('connecting');
    void this.connect(generation);
  }

  stop(): void {
    this.generation++;
    this.attempt = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.removeListener?.();
    this.removeListener = null;
    const hub = this.hub;
    this.hub = null;
    this.state.set('off');
    hub?.stop().catch(() => undefined);
  }

  private async connect(generation: number): Promise<void> {
    const hub = this.createHub(this.url, () => this.token());
    hub.on('changed', () => void this.engine.syncNow());
    hub.onclose(() => {
      if (generation === this.generation) {
        this.state.set('reconnecting');
        this.scheduleRetry(generation);
      }
    });
    this.hub = hub;

    try {
      await hub.start();
    } catch {
      if (generation === this.generation) {
        this.state.set('reconnecting');
        this.scheduleRetry(generation);
      }
      return;
    }

    if (generation !== this.generation) {
      hub.stop().catch(() => undefined); // stopped while connecting
      return;
    }
    this.attempt = 0;
    this.state.set('live');
    void this.engine.syncNow(); // anything that happened while we were not listening
  }

  private scheduleRetry(generation: number): void {
    if (this.retryTimer) {
      return; // one pause at a time (a failed start and a close can both report the same loss)
    }
    const delay = this.retryDelays[Math.min(this.attempt, this.retryDelays.length - 1)];
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect(generation);
    }, delay);
  }

  /** The browser says the network is back: do not wait out the pause. */
  private retryNow(generation: number): void {
    if (generation !== this.generation || this.state() === 'live' || !this.retryTimer) {
      return; // connected, stopped, or an attempt is already running
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    void this.connect(generation);
  }

  /** The token for a connection attempt: the current one, renewed first when it is about to expire. */
  private async token(): Promise<string> {
    const current = this.auth.accessToken();
    if (current && !expiresWithin(current, TOKEN_MARGIN_MS)) {
      return current;
    }
    try {
      return (await this.auth.refresh()) ?? current ?? '';
    } catch {
      return current ?? ''; // offline: the attempt fails and is tried again later
    }
  }
}
