import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../auth/store/auth.store';
import { HUB_FACTORY, HubLike, REALTIME_RETRY_MS, RealtimeSync } from './realtime-sync.service';
import { SyncEngine } from './sync-engine.service';

/** A SignalR connection that does what the test says: connect, fail, or drop later. */
class FakeHub implements HubLike {
  private handlers = new Map<string, () => void>();
  private closeHandler: (() => void) | null = null;
  stopped = false;

  constructor(
    readonly url: string,
    readonly token: () => Promise<string>,
    private readonly outcome: () => Promise<void>,
  ) {}

  on(method: string, handler: () => void): void {
    this.handlers.set(method, handler);
  }
  onclose(handler: () => void): void {
    this.closeHandler = handler;
  }
  start(): Promise<void> {
    return this.outcome();
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  /** The server rings the doorbell. */
  ring(): void {
    this.handlers.get('changed')?.();
  }
  /** The connection is lost after having been up. */
  drop(): void {
    this.closeHandler?.();
  }
}

describe('RealtimeSync', () => {
  let realtime: RealtimeSync;
  let hubs: FakeHub[];
  let outcomes: (() => Promise<void>)[]; // what the next connection attempts do (made when they start); when it runs out they succeed
  let syncNow: ReturnType<typeof vi.fn>;
  let accessToken: ReturnType<typeof signal<string | null>>;
  let refresh: ReturnType<typeof vi.fn>;

  const ok = () => Promise.resolve();
  // A function, so that the rejected promise only exists once an attempt starts (and is handled by it).
  const fail = () => Promise.reject(new Error('cannot connect'));
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true));

  beforeEach(() => {
    hubs = [];
    outcomes = [];
    syncNow = vi.fn(async () => undefined);
    accessToken = signal<string | null>(null);
    refresh = vi.fn(async () => 'fresh-token');
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncEngine, useValue: { syncNow } },
        { provide: AuthStore, useValue: { accessToken, refresh } },
        { provide: REALTIME_RETRY_MS, useValue: [10, 20] },
        {
          provide: HUB_FACTORY,
          useValue: (url: string, token: () => Promise<string>) => {
            const hub = new FakeHub(url, token, outcomes.shift() ?? ok);
            hubs.push(hub);
            return hub;
          },
        },
      ],
    });
    realtime = TestBed.inject(RealtimeSync);
  });

  afterEach(() => realtime.stop());

  it('connects to the hub of the API and becomes "live", then synchronizes once to catch up', async () => {
    expect(realtime.state()).toBe('off');

    realtime.start();
    expect(realtime.state()).toBe('connecting');
    await until(() => realtime.state() === 'live');

    expect(hubs).toHaveLength(1);
    expect(hubs[0].url).toMatch(/\/hubs\/sync$/);
    expect(syncNow).toHaveBeenCalledTimes(1); // what happened while nobody listened
  });

  it('runs the synchronization every time the server says "changed"', async () => {
    realtime.start();
    await until(() => realtime.state() === 'live');
    syncNow.mockClear();

    hubs[0].ring();
    hubs[0].ring();

    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('keeps trying after a failure, with a pause, and catches up once it connects', async () => {
    outcomes = [fail, fail];

    realtime.start();
    await until(() => realtime.state() === 'live');

    expect(hubs).toHaveLength(3); // a fresh connection for every attempt
    expect(syncNow).toHaveBeenCalledTimes(1); // once, after connecting (nothing to catch up on while not connected)
  });

  it('reconnects when a live connection is lost, and catches up on what it missed', async () => {
    realtime.start();
    await until(() => realtime.state() === 'live');
    syncNow.mockClear();

    hubs[0].drop();
    expect(realtime.state()).toBe('reconnecting');
    await until(() => realtime.state() === 'live');

    expect(hubs).toHaveLength(2);
    expect(syncNow).toHaveBeenCalledTimes(1); // notifications lost meanwhile are recovered by one pull
  });

  it('waits longer after each failure, up to the last pause of the list', async () => {
    vi.useFakeTimers();
    try {
      outcomes = [fail, fail, fail, fail];
      realtime.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(hubs).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(9);
      expect(hubs).toHaveLength(1); // first pause: 10 ms
      await vi.advanceTimersByTimeAsync(1);
      expect(hubs).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(19);
      expect(hubs).toHaveLength(2); // second pause: 20 ms
      await vi.advanceTimersByTimeAsync(1);
      expect(hubs).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(19);
      expect(hubs).toHaveLength(3); // the list is over: it stays at 20 ms
      await vi.advanceTimersByTimeAsync(1);
      expect(hubs).toHaveLength(4);
    } finally {
      realtime.stop();
      vi.useRealTimers();
    }
  });

  it('stop() closes the connection, goes quiet and never reconnects', async () => {
    realtime.start();
    await until(() => realtime.state() === 'live');

    realtime.stop();
    hubs[0].drop(); // SignalR reports the close that stop() caused
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(realtime.state()).toBe('off');
    expect(hubs[0].stopped).toBe(true);
    expect(hubs).toHaveLength(1);
  });

  it('stop() while still connecting: the late connection is closed, nothing goes live', async () => {
    let connected!: () => void;
    const pending = new Promise<void>((resolve) => (connected = resolve));
    outcomes = [() => pending];
    realtime.start();
    await settled();

    realtime.stop();
    connected(); // the connection comes up AFTER the stop
    await settled();

    expect(realtime.state()).toBe('off');
    expect(hubs[0].stopped).toBe(true);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('start() again replaces the old connection instead of keeping two', async () => {
    realtime.start();
    await until(() => realtime.state() === 'live');

    realtime.start();
    await until(() => hubs.length === 2 && realtime.state() === 'live');

    expect(hubs[0].stopped).toBe(true);
    hubs[0].drop(); // the old one reporting its end must not start anything
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(hubs).toHaveLength(2);
  });

  it('tries at once when the browser says the network is back, instead of waiting out the pause', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncEngine, useValue: { syncNow } },
        { provide: AuthStore, useValue: { accessToken, refresh } },
        { provide: REALTIME_RETRY_MS, useValue: [60_000] }, // far too long to wait for
        {
          provide: HUB_FACTORY,
          useValue: (url: string, token: () => Promise<string>) => {
            const hub = new FakeHub(url, token, outcomes.shift() ?? ok);
            hubs.push(hub);
            return hub;
          },
        },
      ],
    });
    realtime = TestBed.inject(RealtimeSync);
    outcomes = [fail];
    realtime.start();
    await until(() => realtime.state() === 'reconnecting');

    window.dispatchEvent(new Event('online'));

    await until(() => realtime.state() === 'live');
    expect(hubs).toHaveLength(2);
  });

  describe('the access token given to every attempt', () => {
    const jwt = (secondsLeft: number) =>
      `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsLeft }))}.s`;

    it('is the current one while it is good for a while', async () => {
      accessToken.set(jwt(600));
      realtime.start();
      await until(() => hubs.length === 1);

      expect(await hubs[0].token()).toBe(accessToken());
      expect(refresh).not.toHaveBeenCalled();
    });

    it('is renewed first when it is about to expire (a reconnect after a long pause)', async () => {
      accessToken.set(jwt(5));
      realtime.start();
      await until(() => hubs.length === 1);

      expect(await hubs[0].token()).toBe('fresh-token');
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('is renewed when there is none (the app started offline and the first refresh failed)', async () => {
      accessToken.set(null);
      realtime.start();
      await until(() => hubs.length === 1);

      expect(await hubs[0].token()).toBe('fresh-token');
    });

    it('falls back to the old one when renewing fails (offline): the attempt fails and is retried later', async () => {
      accessToken.set(jwt(5));
      refresh.mockRejectedValue(new Error('network'));
      realtime.start();
      await until(() => hubs.length === 1);

      expect(await hubs[0].token()).toBe(accessToken());
    });

    it('is empty when the session is over (refresh answers "no session")', async () => {
      accessToken.set(null);
      refresh.mockResolvedValue(null);
      realtime.start();
      await until(() => hubs.length === 1);

      expect(await hubs[0].token()).toBe('');
    });
  });
});
