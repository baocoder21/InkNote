import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { LocalDbService } from './local/local-db';
import { LocalSession } from './local-session.service';
import { HUB_FACTORY, HubLike, RealtimeSync } from './realtime-sync.service';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncEngine } from './sync-engine.service';

let counter = 0;

describe('LocalSession', () => {
  let session: LocalSession;
  let local: LocalDbService;
  let engine: SyncEngine;
  let http: HttpTestingController;
  let user: string;
  let realtime: RealtimeSync;
  let stops: number; // how many connections were closed

  beforeEach(() => {
    user = `session-user-${++counter}`;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SYNC_DEBOUNCE_MS, useValue: 60 },
        { provide: SYNC_INTERVAL_MS, useValue: 0 },
        {
          // No real connection in this test: a hub that connects at once and remembers it was stopped.
          provide: HUB_FACTORY,
          useValue: (): HubLike => {
            const hub = { on: () => undefined, onclose: () => undefined, start: () => Promise.resolve(), stop: () => (stops++, Promise.resolve()) };
            return hub;
          },
        },
      ],
    });
    stops = 0;
    realtime = TestBed.inject(RealtimeSync);
    session = TestBed.inject(LocalSession);
    local = TestBed.inject(LocalDbService);
    engine = TestBed.inject(SyncEngine);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    realtime.stop();
    engine.stop();
    await local.wipe();
  });

  it('begin also starts listening for the server\'s "changed", end and wipe stop it', async () => {
    await session.begin(user);
    await vi.waitFor(() => expect(realtime.state()).toBe('live'));

    session.end();
    expect(realtime.state()).toBe('off');
    expect(stops).toBe(1);

    await session.begin(user);
    await vi.waitFor(() => expect(realtime.state()).toBe('live'));
    await session.wipe();
    expect(realtime.state()).toBe('off');
    expect(stops).toBe(2);
  });

  const pullRequests = () => http.match((r) => r.url.endsWith('/api/sync/pull'));

  /** Answers every pull the engine asks for (the start, and the catch-up after the real-time connection) until it is quiet. */
  async function answerPulls(): Promise<void> {
    for (let quietRounds = 0; quietRounds < 2; ) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const found = pullRequests();
      found.forEach((r) => r.flush({ changes: [], cursor: 0, hasMore: false }));
      quietRounds = found.length === 0 ? quietRounds + 1 : 0;
    }
  }

  it('begin opens the database of that user and starts synchronizing (the catch-up pull)', async () => {
    await session.begin(user);

    expect(local.openUserId()).toBe(user);
    await vi.waitFor(() => {
      const found = pullRequests();
      expect(found).toHaveLength(1);
      found[0].flush({ changes: [], cursor: 0, hasMore: false });
    });
  });

  it('begin again for the same user does nothing (the page can be opened twice)', async () => {
    await session.begin(user);
    await vi.waitFor(() => expect(realtime.state()).toBe('live'));
    await answerPulls(); // the first start's catch-up and the one after the real-time connection

    await session.begin(user);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(pullRequests()).toHaveLength(0); // no second start, so no second catch-up
  });

  it('end stops synchronizing and closes the database, but keeps the data on disk', async () => {
    await session.begin(user);
    await local.db.meta.put({ key: 'probe', value: 1 });
    session.end();

    expect(local.openUserId()).toBeNull();
    expect(engine.state()).toBe('idle');
    pullRequests(); // the catch-up that was already sent is simply left unanswered

    await local.open(user); // the same user comes back: the data is still there
    expect((await local.db.meta.get('probe'))?.value).toBe(1);
  });

  it('wipe deletes everything of that user from this device', async () => {
    await session.begin(user);
    await local.db.meta.put({ key: 'probe', value: 1 });

    await session.wipe();

    expect(local.openUserId()).toBeNull();
    expect(await Dexie.exists(`inknote-${user}`)).toBe(false);
  });

  it('wipe leaves other users alone', async () => {
    const other = `${user}-other`;
    await local.open(other);
    await local.db.meta.put({ key: 'probe', value: 1 });
    local.close();

    await session.begin(user);
    await session.wipe();

    expect(await Dexie.exists(`inknote-${other}`)).toBe(true);
    await local.open(other);
    await local.wipe(); // cleanup
  });
});
