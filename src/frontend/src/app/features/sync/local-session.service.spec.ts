import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { LocalDbService } from './local/local-db';
import { LocalSession } from './local-session.service';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncEngine } from './sync-engine.service';

let counter = 0;

describe('LocalSession', () => {
  let session: LocalSession;
  let local: LocalDbService;
  let engine: SyncEngine;
  let http: HttpTestingController;
  let user: string;

  beforeEach(() => {
    user = `session-user-${++counter}`;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SYNC_DEBOUNCE_MS, useValue: 60 },
        { provide: SYNC_INTERVAL_MS, useValue: 0 },
      ],
    });
    session = TestBed.inject(LocalSession);
    local = TestBed.inject(LocalDbService);
    engine = TestBed.inject(SyncEngine);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    engine.stop();
    await local.wipe();
  });

  const pullRequests = () => http.match((r) => r.url.endsWith('/api/sync/pull'));

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
    await vi.waitFor(() => {
      const found = pullRequests();
      expect(found).toHaveLength(1); // the first start's catch-up
      found[0].flush({ changes: [], cursor: 0, hasMore: false });
    });

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
