import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/api.config';
import { LocalDbService } from '../../sync/local/local-db';
import { AttachmentRepository } from '../data/attachment-repository';
import { AttachmentResolver } from './attachment-resolver.service';

let counter = 0;
const URL_OF = (id: string) => `${API_BASE_URL}/api/attachments/${id}/url`;

const address = (overrides = {}) => ({
  url: 'https://storage.example/bucket/key?signature=abc',
  expiresAt: '2026-01-01T00:05:00Z',
  contentType: 'image/png',
  fileName: 'cat.png',
  isImage: true,
  ...overrides,
});

describe('AttachmentResolver', () => {
  let resolver: AttachmentResolver;
  let repo: AttachmentRepository;
  let local: LocalDbService;
  let http: HttpTestingController;
  let created: number;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    resolver = TestBed.inject(AttachmentResolver);
    repo = TestBed.inject(AttachmentRepository);
    local = TestBed.inject(LocalDbService);
    http = TestBed.inject(HttpTestingController);
    await local.open(`resolver-${++counter}`);

    // jsdom has no object URLs and no network: small stand-ins that remember what was asked.
    created = 0;
    URL.createObjectURL = vi.fn(() => `blob:fake-${++created}`);
    URL.revokeObjectURL = vi.fn();
    fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    http.verify();
    await local.wipe();
  });

  const storeLocally = async (id: string, name = 'mine.png', type = 'image/png') => {
    await local.db.blobs.put({ id, name, type, size: 3, data: new Uint8Array([9, 9, 9]).buffer, cachedAt: Date.now() });
  };

  describe('a file that is on this device', () => {
    it('is shown from there at once: no request, an address of our own', async () => {
      await storeLocally('a');

      const resolved = await resolver.resolve('a');

      expect(resolved).toEqual({ url: 'blob:fake-1', name: 'mine.png', isImage: true });
      http.expectNone(() => true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is remembered: known() answers without waiting, and nothing is made twice', async () => {
      await storeLocally('a');
      expect(resolver.known('a')).toBeNull();

      await resolver.resolve('a');
      await resolver.resolve('a');

      expect(resolver.known('a')).toMatchObject({ url: 'blob:fake-1' });
      expect(created).toBe(1);
    });

    it('is not an image when its type says so (a PDF written as an image would not be shown as one)', async () => {
      await storeLocally('p', 'report.pdf', 'application/pdf');

      expect((await resolver.resolve('p'))!.isImage).toBe(false);
    });
  });

  describe('a file that is only on the server', () => {
    it('is asked for, downloaded, KEPT on this device, and shown from the local copy', async () => {
      const result = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address()));
      const resolved = await result;

      expect(fetchMock).toHaveBeenCalledWith('https://storage.example/bucket/key?signature=abc', { mode: 'cors', credentials: 'omit' });
      expect(resolved).toEqual({ url: 'blob:fake-1', name: 'cat.png', isImage: true });
      expect(await repo.blob('s')).toMatchObject({ name: 'cat.png', type: 'image/png', size: 3 });
    });

    it('the next time (offline too) comes from this device: the server is not asked again', async () => {
      const first = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address()));
      await first;
      resolver.clear(); // forget the addresses made, keep the database

      const again = await resolver.resolve('s');

      http.expectNone(() => true);
      expect(again).toMatchObject({ name: 'cat.png' });
    });

    it('uses the address as it is when the browser will not let the page READ the file (no CORS permission)', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address()));

      expect(await result).toEqual({ url: 'https://storage.example/bucket/key?signature=abc', name: 'cat.png', isImage: true });
      expect(await repo.blob('s')).toBeUndefined(); // not kept: we never had the bytes
    });

    it('shows nothing when the storage answers with an error (an address that expired, a file that is gone)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });

      const result = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address()));

      expect(await result).toBeNull();
    });

    it.each([
      [404, 'does not exist, or is not yours'],
      [500, 'the server fails'],
    ])('shows nothing when the server answers %i (%s)', async (status) => {
      const result = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush({}, { status, statusText: 'No' }));

      expect(await result).toBeNull();
    });

    it('shows nothing when there is no connection, and tries again the next time', async () => {
      const first = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).error(new ProgressEvent('error')));
      expect(await first).toBeNull();

      const second = resolver.resolve('s'); // a failure is not remembered
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address()));
      expect(await second).toMatchObject({ name: 'cat.png' });
    });

    it('asks only once when the same file is wanted in several places at once (the same image twice in a note)', async () => {
      const first = resolver.resolve('s');
      const second = resolver.resolve('s');
      await vi.waitFor(() => http.expectOne(URL_OF('s')).flush(address())); // expectOne: exactly one request

      expect(await first).toBe(await second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('download (a PDF, a text file...)', () => {
    let clicked: { href: string; download: string }[];

    beforeEach(() => {
      clicked = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
    });

    it('saves the copy on this device under its own name', async () => {
      await storeLocally('d', 'report.pdf', 'application/pdf');

      expect(await resolver.download('d')).toBe(true);

      expect(clicked).toEqual([{ href: 'blob:fake-1', download: 'report.pdf' }]);
      http.expectNone(() => true);
    });

    it('otherwise asks the server for a DOWNLOAD address (the browser then saves instead of showing)', async () => {
      const done = resolver.download('d');
      const request = await vi.waitFor(() => http.expectOne((r) => r.url === URL_OF('d')));
      expect(request.request.params.get('download')).toBe('true');
      request.flush(address({ url: 'https://storage.example/report?sig=1', fileName: 'report.pdf', contentType: 'application/pdf', isImage: false }));

      expect(await done).toBe(true);
      expect(clicked).toEqual([{ href: 'https://storage.example/report?sig=1', download: 'report.pdf' }]);
    });

    it('says false when the file is not here and the server cannot be reached', async () => {
      const done = resolver.download('d');
      await vi.waitFor(() => http.expectOne((r) => r.url === URL_OF('d')).error(new ProgressEvent('error')));

      expect(await done).toBe(false);
      expect(clicked).toEqual([]);
    });
  });

  it('clear() gives back the addresses it made and forgets what it knew', async () => {
    await storeLocally('a');
    await resolver.resolve('a');

    resolver.clear();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    expect(resolver.known('a')).toBeNull();
  });
});
