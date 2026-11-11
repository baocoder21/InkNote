import { NoteFileData, parseNoteFile, serializeNoteFile } from './note-file';

const note = (over: Partial<NoteFileData> = {}): NoteFileData => ({
  title: 'Weekly plan',
  content: '# Heading\n\nSome **text**.\n',
  tags: [],
  status: 'None',
  pinned: false,
  ...over,
});

describe('serializeNoteFile', () => {
  it('writes front matter, a blank line, then the text exactly as it is', () => {
    const file = serializeNoteFile(note({ tags: ['work', 'plan'], status: 'Active', pinned: true, createdAt: '2026-03-04T09:00:00.000Z' }));

    expect(file).toBe(
      [
        '---',
        'title: "Weekly plan"',
        'tags: ["work", "plan"]',
        'status: Active',
        'pinned: true',
        'created: "2026-03-04T09:00:00.000Z"',
        '---',
        '',
        '# Heading',
        '',
        'Some **text**.',
        '',
      ].join('\n'),
    );
  });

  it('leaves out what is the default: no tags, no status, not pinned', () => {
    expect(serializeNoteFile(note())).toBe('---\ntitle: "Weekly plan"\n---\n\n# Heading\n\nSome **text**.\n');
  });

  it('writes strings as JSON, so quotes, colons and line breaks in a title cannot break the block', () => {
    const file = serializeNoteFile(note({ title: 'He said "hi": a\nb', tags: ['a, b', 'c"d'] }));

    expect(file.split('\n')[1]).toBe('title: "He said \\"hi\\": a\\nb"');
    expect(file).toContain('tags: ["a, b", "c\\"d"]');
  });
});

describe('parseNoteFile: reading what the writer wrote', () => {
  const roundTrip = (data: NoteFileData) => parseNoteFile(serializeNoteFile(data), 'x.md');

  it.each([
    ['plain', note()],
    ['everything set', note({ tags: ['work', 'plan'], status: 'OnHold', pinned: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' })],
    ['awkward characters in the title', note({ title: 'He said "hi": a\\b — [x] #1' })],
    ['tags with commas and quotes', note({ tags: ['a, b', 'c"d', "it's"] })],
    ['a text that starts with blank lines', note({ content: '\n\n  indented\n' })],
    ['a text that looks like front matter', note({ content: '---\ntitle: "not this"\n---\nbody' })],
    ['an empty text', note({ content: '' })],
    ['CRLF-free text with unicode', note({ title: 'Cuộc họp 📝', content: 'đường Đồng Khởi\n' })],
    ['every status', note({ status: 'Dropped' })],
  ])('gives back the same data: %s', (_name, data) => {
    const parsed = roundTrip(data);

    expect(parsed.title).toBe(data.title);
    expect(parsed.content).toBe(data.content);
    expect(parsed.tags).toEqual(data.tags);
    expect(parsed.status).toBe(data.status === 'None' ? null : data.status);
    expect(parsed.pinned).toBe(data.pinned ? true : null);
  });
});

describe('parseNoteFile: files written by other tools', () => {
  it('reads an unquoted title and an inline list of tags', () => {
    const parsed = parseNoteFile('---\ntitle: My note\ntags: [work, "big plan", \'x\']\n---\nBody', 'a.md');

    expect(parsed).toMatchObject({ title: 'My note', content: 'Body', tags: ['work', 'big plan', 'x'] });
  });

  it('reads a YAML list of tags (one per line)', () => {
    const parsed = parseNoteFile('---\ntags:\n  - work\n  - "plan b"\n  - #idea\n---\nBody', 'a.md');

    expect(parsed.tags).toEqual(['work', 'plan b', 'idea']);
  });

  it('reads tags written as a comma separated text', () => {
    expect(parseNoteFile('---\ntags: work, plan\n---\nB', 'a.md').tags).toEqual(['work', 'plan']);
  });

  it('removes a leading # and duplicates (ignoring case) from tags, and keeps tags within the length limit', () => {
    const long = 'x'.repeat(80);
    const parsed = parseNoteFile(`---\ntags: ["#Work", "work", "WORK", "${long}"]\n---\nB`, 'a.md');

    expect(parsed.tags).toEqual(['Work', 'x'.repeat(50)]);
  });

  it.each([
    ['Active', 'Active'],
    ['active', 'Active'],
    ['on hold', 'OnHold'],
    ['On-Hold', 'OnHold'],
    ['on_hold', 'OnHold'],
    ['COMPLETED', 'Completed'],
    ['dropped', 'Dropped'],
    ['none', 'None'],
  ])('understands the status "%s"', (written, expected) => {
    expect(parseNoteFile(`---\nstatus: ${written}\n---\nB`, 'a.md').status).toBe(expected);
  });

  it('ignores a status it does not know, and keys it does not know', () => {
    const parsed = parseNoteFile('---\nstatus: busy\nauthor: Ann\ncolor: red\n---\nBody', 'a.md');

    expect(parsed.status).toBeNull();
    expect(parsed.content).toBe('Body');
  });

  it.each([['true', true], ['yes', true], ['false', false], ['no', false], ['maybe', null]])('reads pinned: %s', (written, expected) => {
    expect(parseNoteFile(`---\npinned: ${written}\n---\nB`, 'a.md').pinned).toBe(expected);
  });

  it('reads CRLF files and a byte order mark', () => {
    const parsed = parseNoteFile('\uFEFF---\r\ntitle: Windows\r\n---\r\n\r\nline 1\r\nline 2\r\n', 'a.md');

    expect(parsed.title).toBe('Windows');
    expect(parsed.content).toBe('line 1\nline 2\n');
  });

  it('does not need a blank line after the front matter', () => {
    expect(parseNoteFile('---\ntitle: T\n---\nstraight to the text', 'a.md').content).toBe('straight to the text');
  });

  it('accepts "..." as the end of the front matter', () => {
    expect(parseNoteFile('---\ntitle: T\n...\nBody', 'a.md')).toMatchObject({ title: 'T', content: 'Body' });
  });

  it('treats a first line of --- that is never closed as plain text (a horizontal rule), not as front matter', () => {
    const parsed = parseNoteFile('---\nnot closed\nstill text', 'My file.md');

    expect(parsed.content).toBe('---\nnot closed\nstill text');
    expect(parsed.title).toBe('My file');
  });

  describe('a file with no title in it', () => {
    it('takes the first heading as the title and does not repeat it in the text', () => {
      const parsed = parseNoteFile('# Meeting notes\n\nWe talked.\n', 'whatever.md');

      expect(parsed.title).toBe('Meeting notes');
      expect(parsed.content).toBe('We talked.\n');
    });

    it('also after front matter that has no title, and ignores closing hashes of the heading', () => {
      const parsed = parseNoteFile('---\ntags: [a]\n---\n\n# Title ##\ntext', 'x.md');

      expect(parsed.title).toBe('Title');
      expect(parsed.content).toBe('text');
    });

    it('does not take a later heading, a deeper heading, or a heading with no space after #', () => {
      expect(parseNoteFile('text first\n# Later', 'My notes.md').title).toBe('My notes');
      expect(parseNoteFile('## Second level\ntext', 'a.md').title).toBe('a');
      expect(parseNoteFile('#hashtag text', 'a.md').title).toBe('a');
    });

    it('uses the file name without its extension and its folder', () => {
      expect(parseNoteFile('text', 'Work/2026/Plan.md').title).toBe('Plan');
      expect(parseNoteFile('text', 'C:\\docs\\Plan.markdown').title).toBe('Plan');
      expect(parseNoteFile('text', 'notes.txt').title).toBe('notes');
    });

    it('uses "Untitled" when there is nothing at all to use', () => {
      expect(parseNoteFile('text', '.md').title).toBe('Untitled');
      expect(parseNoteFile('', '').title).toBe('Untitled');
    });
  });

  it('turns a long or multi-line title into one line of at most 200 characters', () => {
    const parsed = parseNoteFile(`---\ntitle: "${'a'.repeat(300)}"\n---\nB`, 'a.md');
    expect(parsed.title).toHaveLength(200);

    expect(parseNoteFile('---\ntitle: "one\\ntwo   three"\n---\nB', 'a.md').title).toBe('one two three');
  });

  it('takes a title from the front matter over a heading in the text, and keeps the heading in the text', () => {
    const parsed = parseNoteFile('---\ntitle: From the front matter\n---\n\n# A heading\n', 'a.md');

    expect(parsed.title).toBe('From the front matter');
    expect(parsed.content).toBe('# A heading\n');
  });

  it('survives a broken JSON string in a value', () => {
    expect(parseNoteFile('---\ntitle: "broken \\q\n---\nB', 'a.md').title).toBeTruthy();
    expect(parseNoteFile('---\ntitle: "unterminated\n---\nB', 'a.md').content).toBe('B');
  });
});
