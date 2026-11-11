import Dexie from 'dexie';
import { live } from './live';

let counter = 0;

describe('live (a Dexie live query as an Observable)', () => {
  let db: Dexie & { items: Dexie.Table<{ id: number; label: string }, number> };

  beforeEach(async () => {
    db = new Dexie(`live-${++counter}`) as typeof db;
    db.version(1).stores({ items: 'id' });
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(db.name);
  });

  it('emits the answer, and again every time what it read changes', async () => {
    const seen: string[][] = [];
    const subscription = live(() => db.items.toArray()).subscribe((rows) => seen.push(rows.map((r) => r.label)));
    await vi.waitFor(() => expect(seen).toEqual([[]]));

    await db.items.add({ id: 1, label: 'a' });
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(['a']));
    subscription.unsubscribe();
  });

  it('stops watching when the subscription ends', async () => {
    const seen: number[] = [];
    const subscription = live(() => db.items.count()).subscribe((n) => seen.push(n));
    await vi.waitFor(() => expect(seen).toEqual([0]));
    subscription.unsubscribe();

    await db.items.add({ id: 1, label: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen).toEqual([0]);
  });

  it('an exception thrown AT ONCE by the query (a database that is not open) is an error of the Observable', async () => {
    const failures: unknown[] = [];

    live(() => {
      throw new Error('The local database is not open yet.');
    }).subscribe({ error: (e) => failures.push(e) });

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect((failures[0] as Error).message).toContain('not open yet');
  });

  it('a failure when the query runs AGAIN is an error too, not an uncaught exception', async () => {
    let broken = false;
    const failures: unknown[] = [];
    const values: number[] = [];
    live(() => {
      if (broken) {
        throw new Error('closed meanwhile');
      }
      return db.items.count();
    }).subscribe({ next: (n) => values.push(n), error: (e) => failures.push(e) });
    await vi.waitFor(() => expect(values).toEqual([0]));

    broken = true;
    await db.items.add({ id: 1, label: 'a' }); // makes the query run again, and now it throws

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect((failures[0] as Error).message).toBe('closed meanwhile');
  });
});
