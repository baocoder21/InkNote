import { TestBed } from '@angular/core/testing';
import { LocalDbService } from '../../sync/local/local-db';
import { MAX_ATTACHMENT_BYTES } from '../models/attachment.model';
import { ATTACHMENT_CACHE_LIMIT_BYTES, AttachmentRepository } from './attachment-repository';

let counter = 0;

const png = (name = 'photo.png', size = 64) => new File([new Uint8Array(size).fill(7)], name, { type: 'image/png' });
const bytes = (size: number) => new Uint8Array(size).fill(1).buffer;

describe('AttachmentRepository', () => {
  let repo: AttachmentRepository;
  let local: LocalDbService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: ATTACHMENT_CACHE_LIMIT_BYTES, useValue: 1000 }] });
    repo = TestBed.inject(AttachmentRepository);
    local = TestBed.inject(LocalDbService);
    await local.open(`attachments-${++counter}`);
  });

  afterEach(() => local.wipe());

  describe('add (a file pasted or dropped by the user)', () => {
    it('stores the bytes AND queues the upload, under one id of our own, with nothing sent anywhere', async () => {
      const result = await repo.add('note-1', png('My Photo.png', 64));

      expect(result).toMatchObject({ status: 'ok', name: 'My Photo.png', isImage: true });
      if (result.status !== 'ok') return;
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      const stored = await repo.blob(result.id);
      expect(stored).toMatchObject({ id: result.id, name: 'My Photo.png', type: 'image/png', size: 64 });
      expect(new Uint8Array(stored!.data)).toEqual(new Uint8Array(64).fill(7)); // the very bytes of the file
      expect(await repo.uploads()).toMatchObject([{ id: result.id, noteId: 'note-1', attempts: 0 }]);
    });

    it('gives every file its own id', async () => {
      const a = await repo.add('n', png('a.png'));
      const b = await repo.add('n', png('b.png'));

      expect(a.status === 'ok' && b.status === 'ok' && a.id !== b.id).toBe(true);
      expect(await repo.uploads()).toHaveLength(2);
    });

    it('treats a PDF and a text file as files to link to, not images', async () => {
      const pdf = await repo.add('n', new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' }));
      const text = await repo.add('n', new File(['hello'], 'notes.txt'));

      expect(pdf).toMatchObject({ status: 'ok', isImage: false });
      expect(text).toMatchObject({ status: 'ok', isImage: false });
      if (text.status === 'ok') expect((await repo.blob(text.id))!.type).toBe('text/plain');
    });

    it.each([
      ['a kind that is not allowed', new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), 'not allowed'],
      ['an empty file', new File([], 'empty.png', { type: 'image/png' }), 'empty'],
    ])('refuses %s and stores NOTHING', async (_name, file, reason) => {
      const result = await repo.add('n', file);

      expect(result).toMatchObject({ status: 'rejected' });
      expect(result.status === 'rejected' && result.reason).toContain(reason);
      expect(await local.db.blobs.count()).toBe(0);
      expect(await repo.uploads()).toEqual([]);
    });

    it('refuses a file over the size limit without even reading it', async () => {
      const big = { name: 'big.png', size: MAX_ATTACHMENT_BYTES + 1, type: 'image/png', arrayBuffer: vi.fn() } as unknown as File;

      const result = await repo.add('n', big);

      expect(result).toMatchObject({ status: 'rejected' });
      expect((big as unknown as { arrayBuffer: () => void }).arrayBuffer).not.toHaveBeenCalled();
    });

    it('says so when the browser has no room left, and keeps neither half of the pair', async () => {
      vi.spyOn(local.db.blobs, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));

      const result = await repo.add('n', png());

      expect(result.status === 'rejected' && result.reason).toContain('not enough space');
      expect(await local.db.uploads.count()).toBe(0); // one transaction: nothing queued without its bytes
    });
  });

  describe('the upload queue', () => {
    it('lists the files waiting, oldest first', async () => {
      const first = await repo.add('n', png('1.png'));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await repo.add('n', png('2.png'));

      expect((await repo.uploads()).map((u) => u.id)).toEqual([
        first.status === 'ok' ? first.id : '',
        second.status === 'ok' ? second.id : '',
      ]);
    });

    it('uploaded() takes it off the queue but keeps its bytes: this device keeps showing the file', async () => {
      const added = await repo.add('n', png());
      if (added.status !== 'ok') throw new Error('expected ok');

      await repo.uploaded(added.id);

      expect(await repo.uploads()).toEqual([]);
      expect(await repo.blob(added.id)).toBeDefined();
    });

    it('failed() counts the attempt and leaves the file in the queue', async () => {
      const added = await repo.add('n', png());
      if (added.status !== 'ok') throw new Error('expected ok');

      await repo.failed(added.id);
      await repo.failed(added.id);

      expect(await repo.uploads()).toMatchObject([{ id: added.id, attempts: 2 }]);
    });

    it('drop() removes the file from the queue AND from this device (the server refused it for good)', async () => {
      const added = await repo.add('n', png());
      if (added.status !== 'ok') throw new Error('expected ok');

      await repo.drop(added.id);

      expect(await repo.uploads()).toEqual([]);
      expect(await repo.blob(added.id)).toBeUndefined();
    });
  });

  describe('keeping downloaded files for offline use', () => {
    it('stores a file from the server under its id', async () => {
      await repo.cache('srv-1', 'cat.png', 'image/png', bytes(100));

      expect(await repo.blob('srv-1')).toMatchObject({ name: 'cat.png', type: 'image/png', size: 100 });
      expect(await repo.uploads()).toEqual([]); // it is not waiting to be sent
    });

    it('removes the OLDEST downloaded files when more than the limit would be kept', async () => {
      await repo.cache('old', 'a', 'image/png', bytes(400));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await repo.cache('middle', 'b', 'image/png', bytes(400));
      await new Promise((resolve) => setTimeout(resolve, 5));

      await repo.cache('new', 'c', 'image/png', bytes(400)); // 1200 > 1000

      expect(await repo.blob('old')).toBeUndefined();
      expect(await repo.blob('middle')).toBeDefined();
      expect(await repo.blob('new')).toBeDefined();
    });

    it('never removes a file that is still waiting to be uploaded, however old, nor the file just stored', async () => {
      const waiting = await repo.add('n', png('mine.png', 600));
      if (waiting.status !== 'ok') throw new Error('expected ok');
      await new Promise((resolve) => setTimeout(resolve, 5));

      await repo.cache('big-1', 'a', 'image/png', bytes(600));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await repo.cache('big-2', 'b', 'image/png', bytes(600)); // the waiting file alone takes most of the room

      expect(await repo.blob(waiting.id)).toBeDefined(); // the user's own file, not yet on the server
      expect(await repo.blob('big-2')).toBeDefined(); // the one being shown right now
      expect(await repo.blob('big-1')).toBeUndefined(); // the only one that could go
    });
  });
});
