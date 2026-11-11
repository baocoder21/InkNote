import { pathKey, relativeLink, resolveLink, safeName, uniqueName } from './zip-paths';

describe('safeName', () => {
  it('keeps an ordinary name', () => {
    expect(safeName('Weekly plan')).toBe('Weekly plan');
    expect(safeName('Cuộc họp đường Đồng Khởi 📝')).toBe('Cuộc họp đường Đồng Khởi 📝');
  });

  it.each([
    ['Work / 2026', 'Work _ 2026'],
    ['What? Why: now', 'What_ Why_ now'],
    ['a\\b|c<d>e"f*g', 'a_b_c_d_e_f_g'],
    ['line\nbreak\ttab', 'line_break_tab'],
  ])('replaces what a file system forbids: %j', (name, expected) => {
    expect(safeName(name)).toBe(expected);
  });

  it('removes control characters', () => {
    expect(safeName('a\u0000b\u001fc')).toBe('a_b_c');
  });

  it('has no leading or trailing dots and spaces (Windows drops them, and ".." must never be a name)', () => {
    expect(safeName('  ..hidden. ')).toBe('hidden');
    expect(safeName('..')).toBe('Untitled');
    expect(safeName('.')).toBe('Untitled');
    expect(safeName('   ')).toBe('Untitled');
  });

  it('shortens a long name without leaving a trailing dot or space', () => {
    const result = safeName('x'.repeat(78) + ' . tail', 80);

    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).not.toMatch(/[\s.]$/);
  });

  it.each(['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'nul.txt'])('does not give a name Windows reserves: %s', (name) => {
    expect(safeName(name)).toMatch(/_$/);
  });

  it('does not touch names that only start like a reserved one', () => {
    expect(safeName('Console')).toBe('Console');
    expect(safeName('COM10')).toBe('COM10');
  });

  it('uses the fallback for an empty result', () => {
    expect(safeName('', 80, 'Folder')).toBe('Folder');
  });
});

describe('uniqueName', () => {
  it('numbers a name that is taken, ignoring case, and remembers every name it gives', () => {
    const taken = new Set<string>();

    expect(uniqueName('Plan', '.md', taken)).toBe('Plan.md');
    expect(uniqueName('Plan', '.md', taken)).toBe('Plan (2).md');
    expect(uniqueName('plan', '.md', taken)).toBe('plan (3).md');
    expect(uniqueName('Plan', '.txt', taken)).toBe('Plan.txt');
  });
});

describe('relativeLink', () => {
  it('goes up out of every folder of the note, then down to the file', () => {
    expect(relativeLink([], ['_attachments', 'a.png'])).toBe('_attachments/a.png');
    expect(relativeLink(['Work'], ['_attachments', 'a.png'])).toBe('../_attachments/a.png');
    expect(relativeLink(['Work', '2026'], ['_attachments', 'a.png'])).toBe('../../_attachments/a.png');
  });

  it('encodes each segment so a space or parenthesis cannot end the Markdown link', () => {
    expect(relativeLink([], ['_attachments', 'my photo (1).png'])).toBe('_attachments/my%20photo%20%281%29.png');
    expect(relativeLink([], ['_attachments', 'a ) b.png'])).toBe('_attachments/a%20%29%20b.png');
  });
});

describe('resolveLink', () => {
  it('resolves a link against the folder of the note', () => {
    expect(resolveLink(['Work'], 'img/a.png')).toEqual(['Work', 'img', 'a.png']);
    expect(resolveLink(['Work', '2026'], '../_attachments/a.png')).toEqual(['Work', '_attachments', 'a.png']);
    expect(resolveLink([], './a.png')).toEqual(['a.png']);
  });

  it('decodes %-sequences and drops a query or an anchor', () => {
    expect(resolveLink([], 'my%20photo.png?raw=1#top')).toEqual(['my photo.png']);
  });

  it('understands a link in <angle brackets> (the way a path with spaces is written)', () => {
    expect(resolveLink([], '<my photo.png>')).toEqual(['my photo.png']);
  });

  it('takes a path that starts with / from the root of the zip', () => {
    expect(resolveLink(['Work'], '/_attachments/a.png')).toEqual(['_attachments', 'a.png']);
  });

  it('accepts backslashes (a zip made on Windows)', () => {
    expect(resolveLink([], 'img\\a.png')).toEqual(['img', 'a.png']);
  });

  it.each([
    'https://example.com/a.png',
    'http://example.com/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'mailto:a@b.c',
    '//cdn.example.com/a.png',
    '#anchor',
    '',
    '   ',
    '%E0%A4%A', // a broken %-sequence
  ])('is not a path inside the zip: %j', (href) => {
    expect(resolveLink(['Work'], href)).toBeNull();
  });

  it.each([['../a.png', []], ['../../a.png', ['Work']], ['a/../../../b.png', ['x']], ['/../a.png', []]])(
    'never climbs out of the zip: %j from %j',
    (href, dir) => {
      expect(resolveLink(dir, href)).toBeNull();
    },
  );

  it('a link to a folder itself is nothing', () => {
    expect(resolveLink(['Work'], '..')).toBeNull();
    expect(resolveLink([], '.')).toBeNull();
  });
});

describe('pathKey', () => {
  it('is one lower-case string, so "Notes/A.md" and "notes/a.md" meet', () => {
    expect(pathKey(['Notes', 'A.md'])).toBe(pathKey(['notes', 'a.MD']));
  });
});
