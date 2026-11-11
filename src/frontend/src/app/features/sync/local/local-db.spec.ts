import Dexie from 'dexie';
import { LocalDb } from './local-db';

let counter = 0;

describe('LocalDb schema versions', () => {
  it('a database made by version 1 is upgraded to version 2 WITHOUT losing anything, and gets the tables for files', async () => {
    const name = `upgrade-${++counter}`;
    // The database as the browser has it from before attached files existed: exactly the version 1 schema.
    const old = new Dexie(name);
    old.version(1).stores({
      notes: 'id, notebookId, updatedAt',
      contents: 'id',
      notebooks: 'id, parentId',
      tags: 'id',
      outbox: '++seq, opId, [entity+id]',
      meta: 'key',
    });
    await old.open();
    await old.table('notes').put({ id: 'n1', title: 'Kept', createdAt: '', updatedAt: '', version: 3, notebookId: null, isPinned: false, status: 'None', tagIds: [] });
    await old.table('contents').put({ id: 'n1', content: 'text that must survive' });
    await old.table('outbox').add({ opId: 'op1', entity: 'note', id: 'n1', kind: 'upsert', baseVersion: 3, data: { title: 'Kept' }, awaitsBase: false, attempted: false, createdAt: '' });
    await old.table('meta').put({ key: 'cursor', value: 42 });
    old.close();

    const db = new LocalDb(name);
    await db.open();

    expect((await db.notes.get('n1'))?.title).toBe('Kept');
    expect((await db.contents.get('n1'))?.content).toBe('text that must survive');
    expect(await db.outbox.count()).toBe(1); // a change waiting to be sent is not lost by an app update
    expect((await db.meta.get('cursor'))?.value).toBe(42);
    expect(db.verno).toBe(2);

    // The new tables work.
    await db.blobs.put({ id: 'a', name: 'x.png', type: 'image/png', size: 3, data: new Uint8Array([1, 2, 3]).buffer, cachedAt: 1 });
    await db.uploads.put({ id: 'a', noteId: 'n1', createdAt: 1, attempts: 0 });
    expect(await db.blobs.count()).toBe(1);
    expect(await db.uploads.where('noteId').equals('n1').count()).toBe(1);

    db.close();
    await Dexie.delete(name);
  });

  it('a new database has every table', async () => {
    const db = new LocalDb(`fresh-${++counter}`);
    await db.open();

    expect(db.tables.map((t) => t.name).sort()).toEqual(['blobs', 'contents', 'meta', 'notebooks', 'notes', 'outbox', 'tags', 'uploads']);

    db.close();
    await Dexie.delete(db.name);
  });
});
