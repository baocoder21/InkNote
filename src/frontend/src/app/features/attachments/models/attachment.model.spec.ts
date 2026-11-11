import { MAX_ATTACHMENT_BYTES, attachmentProblem, markdownFor, typeOf } from './attachment.model';

const file = (name: string, size = 100, type = '') => ({ name, size, type });

describe('attachmentProblem (what is worth sending)', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['anim.gif', 'image/gif'],
    ['pic.webp', 'image/webp'],
    ['report.pdf', 'application/pdf'],
    ['report.pdf', ''], // a browser that does not know the type: the name decides
    ['notes.txt', ''],
    ['README.MD', 'text/markdown'],
    ['table.csv', 'text/csv'],
    ['app.log', ''],
    ['data.json', 'application/json'],
  ])('accepts %s (%s)', (name, type) => {
    expect(attachmentProblem(file(name, 100, type))).toBeNull();
  });

  it.each([
    ['logo.svg', 'image/svg+xml'], // can carry scripts
    ['page.html', 'text/html'],
    ['run.exe', 'application/octet-stream'],
    ['archive.zip', 'application/zip'],
    ['no-extension', ''],
  ])('refuses %s (%s)', (name, type) => {
    expect(attachmentProblem(file(name, 100, type))).toContain('not allowed');
  });

  it('refuses an empty file and one over the limit, and accepts one exactly at it', () => {
    expect(attachmentProblem(file('a.png', 0, 'image/png'))).toContain('empty');
    expect(attachmentProblem(file('a.png', MAX_ATTACHMENT_BYTES + 1, 'image/png'))).toContain('larger than 10 MB');
    expect(attachmentProblem(file('a.png', MAX_ATTACHMENT_BYTES, 'image/png'))).toBeNull();
  });
});

describe('typeOf (the type kept with a file)', () => {
  it('keeps a known image or PDF type, and works one out from the name otherwise', () => {
    expect(typeOf({ name: 'x.png', type: 'image/png' })).toBe('image/png');
    expect(typeOf({ name: 'x.pdf', type: '' })).toBe('application/pdf');
    expect(typeOf({ name: 'notes.txt', type: 'text/plain' })).toBe('text/plain');
    expect(typeOf({ name: 'notes.md', type: '' })).toBe('text/plain');
  });

  it('never keeps a type the app would not show as an image (an SVG declared as image/svg+xml stays text)', () => {
    expect(typeOf({ name: 'x.svg', type: 'image/svg+xml' })).toBe('text/plain');
  });
});

describe('markdownFor (the Markdown that refers to a file)', () => {
  const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

  it('writes an image as an image, named without its extension', () => {
    expect(markdownFor(ID, 'holiday photo.png', true)).toBe(`![holiday photo](attachment:${ID})`);
  });

  it('writes anything else as a link that keeps the extension', () => {
    expect(markdownFor(ID, 'report.pdf', false)).toBe(`[report.pdf](attachment:${ID})`);
  });

  it('removes what would end the link text early: brackets, backslashes, line breaks', () => {
    expect(markdownFor(ID, 'a[b]c\\d\ne.pdf', false)).toBe(`[abcde.pdf](attachment:${ID})`);
  });

  it('never leaves the text empty', () => {
    expect(markdownFor(ID, '[]', false)).toBe(`[file](attachment:${ID})`);
    expect(markdownFor(ID, '.png', true)).toBe(`![.png](attachment:${ID})`);
  });
});
