import { strFromU8, strToU8, zipSync } from 'fflate';
import { DEFAULT_ZIP_LIMITS, ZipError, readZip } from './zip-reader';

const zip = (files: Record<string, Uint8Array | string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, typeof data === 'string' ? strToU8(data) : data])));

const limits = (over = {}) => ({ ...DEFAULT_ZIP_LIMITS, ...over });

describe('readZip', () => {
  it('reads files with their paths split into folders', () => {
    const result = readZip(zip({ 'a.md': 'one', 'Work/2026/b.md': 'two' }));

    expect(result.files.map((f) => f.path.join('/')).sort()).toEqual(['Work/2026/b.md', 'a.md']);
    expect(strFromU8(result.files.find((f) => f.path.join('/') === 'Work/2026/b.md')!.bytes)).toBe('two');
    expect(result.skipped).toEqual([]);
  });

  it('keeps the folder entries, including empty ones (a notebook with no notes)', () => {
    const result = readZip(zip({ 'Empty/': new Uint8Array(0), 'Work/a.md': 'x' }));

    expect(result.directories.map((d) => d.join('/'))).toContain('Empty');
    expect(result.files).toHaveLength(1);
  });

  it('unpacks stored (not compressed) and compressed entries alike, and keeps unicode names', () => {
    const stored = zipSync({ 'đường/Đồng Khởi.md': [strToU8('xin chào'), { level: 0 }] });

    const result = readZip(stored);

    expect(result.files[0].path).toEqual(['đường', 'Đồng Khởi.md']);
    expect(strFromU8(result.files[0].bytes)).toBe('xin chào');
  });

  it('leaves out the junk that systems add, and hidden folders', () => {
    const result = readZip(
      zip({
        'a.md': 'keep',
        '__MACOSX/._a.md': 'junk',
        '.DS_Store': 'junk',
        'Thumbs.db': 'junk',
        '.obsidian/app.json': '{}',
        '.git/config': 'x',
        'Work/.hidden.md': 'hidden',
      }),
    );

    expect(result.files.map((f) => f.path.join('/'))).toEqual(['a.md']);
  });

  it('normalizes backslashes (a zip made on Windows) and ignores empty and "." segments', () => {
    const result = readZip(zip({ 'Work\\sub\\a.md': 'x', './b.md': 'y', 'c//d.md': 'z' }));

    expect(result.files.map((f) => f.path.join('/')).sort()).toEqual(['Work/sub/a.md', 'b.md', 'c/d.md']);
  });

  describe('defences', () => {
    it('leaves out an entry whose path climbs out with ".." and says so', () => {
      const result = readZip(zip({ '../evil.md': 'x', 'ok/../../evil2.md': 'x', 'safe.md': 'y' }));

      expect(result.files.map((f) => f.path.join('/'))).toEqual(['safe.md']);
      expect(result.skipped.map((s) => s.path)).toEqual(['../evil.md', 'ok/../../evil2.md']);
      expect(result.skipped[0].reason).toContain('not safe');
    });

    it('drops an entry larger than the limit, keeps the others, and says so', () => {
      const result = readZip(zip({ 'small.md': 'ok', 'big.bin': new Uint8Array(5000) }), limits({ maxEntryBytes: 1000 }));

      expect(result.files.map((f) => f.path.join('/'))).toEqual(['small.md']);
      expect(result.skipped).toMatchObject([{ path: 'big.bin', reason: expect.stringContaining('larger than') }]);
    });

    it('an entry that was dropped does not count against the total of the others', () => {
      const result = readZip(
        zip({ 'big.bin': new Uint8Array(5000), 'a.md': 'a'.repeat(600), 'b.md': 'b'.repeat(600) }),
        limits({ maxEntryBytes: 1000, maxTotalBytes: 1500 }),
      );

      expect(result.files).toHaveLength(2);
    });

    it('refuses a zip with more entries than the limit', () => {
      const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`n${i}.md`, 'x']));

      expect(() => readZip(zip(many), limits({ maxEntries: 10 }))).toThrow(ZipError);
      expect(() => readZip(zip(many), limits({ maxEntries: 10 }))).toThrow(/more than 10 files/);
    });

    it('refuses a zip that is too large once unpacked', () => {
      const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.md`, 'x'.repeat(400)]));

      expect(() => readZip(zip(files), limits({ maxTotalBytes: 1500, maxEntryBytes: 1000 }))).toThrow(/larger than/);
    });

    it('does NOT believe the size written in the zip: a "bomb" that says it is tiny is stopped by what really comes out', () => {
      const bomb = zip({ 'bomb.txt': new Uint8Array(2_000_000) }); // a few KB of zip that unpacks to 2 MB
      lieAboutSize(bomb, 10); // the headers now claim 10 bytes

      const result = readZip(bomb, limits({ maxEntryBytes: 100_000 }));

      expect(result.files.every((f) => f.bytes.length <= 100_000)).toBe(true); // nothing bigger than the limit is ever kept
      expect(result.files.find((f) => f.path[0] === 'bomb.txt')?.bytes.length ?? 0).toBeLessThanOrEqual(100_000);
    });

    it('a real zip bomb of many entries is stopped by the total, not by memory', () => {
      const entries = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`z${i}.bin`, new Uint8Array(500_000)]));

      expect(() => readZip(zip(entries), limits({ maxTotalBytes: 2_000_000, maxEntryBytes: 1_000_000 }))).toThrow(ZipError);
    });

    it.each([
      ['random bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
      ['text', strToU8('this is not a zip file at all')],
    ])('says it is not a zip when the data is %s', (_name, data) => {
      let error: unknown;
      let contents;
      try {
        contents = readZip(data);
      } catch (e) {
        error = e;
      }

      // Either an error, or simply nothing found: never a crash, never an entry made up from garbage.
      if (error) expect(error).toBeInstanceOf(ZipError);
      else expect(contents!.files).toEqual([]);
    });

    it('a truncated zip does not crash and never returns a damaged entry as a whole file', () => {
      const whole = zip({ 'a.md': 'hello '.repeat(100), 'b.md': 'world '.repeat(100) });
      const truncated = whole.slice(0, Math.floor(whole.length / 2));

      let contents;
      try {
        contents = readZip(truncated);
      } catch (e) {
        expect(e).toBeInstanceOf(ZipError);
        return;
      }
      for (const file of contents.files) {
        expect(['hello '.repeat(100), 'world '.repeat(100)]).toContain(strFromU8(file.bytes));
      }
    });
  });
});

/** Writes `size` over the "uncompressed size" fields of every local header and of the central directory. */
function lieAboutSize(zipData: Uint8Array, size: number): void {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  for (let i = 0; i + 30 < zipData.length; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, size, true); // local file header: uncompressed size
    if (signature === 0x02014b50) view.setUint32(i + 24, size, true); // central directory: uncompressed size
  }
}
