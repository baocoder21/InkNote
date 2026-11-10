import { safeReturnUrl } from './safe-return-url';

describe('safeReturnUrl', () => {
  it('keeps a path inside the app, with its query string', () => {
    expect(safeReturnUrl('/notes/123')).toBe('/notes/123');
    expect(safeReturnUrl('/notes?tag=abc')).toBe('/notes?tag=abc');
    expect(safeReturnUrl('/notes/trash')).toBe('/notes/trash');
  });

  it.each([
    ['another website', 'https://evil.example/notes'],
    ['a protocol-relative url', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a relative path', 'notes/1'],
    ['control characters', '/notes/1\r\nSet-Cookie: x=y'],
    ['an empty string', ''],
  ])('falls back for %s', (_name, value) => {
    expect(safeReturnUrl(value)).toBe('/notes');
  });

  it('falls back when there is no value (or not a string)', () => {
    expect(safeReturnUrl(undefined)).toBe('/notes');
    expect(safeReturnUrl(null)).toBe('/notes');
    expect(safeReturnUrl(['/notes/1'])).toBe('/notes');
  });

  it('never returns to the login or register page (that would loop)', () => {
    expect(safeReturnUrl('/login')).toBe('/notes');
    expect(safeReturnUrl('/login?returnUrl=%2Fnotes')).toBe('/notes');
    expect(safeReturnUrl('/register')).toBe('/notes');
    expect(safeReturnUrl('/loginfoo')).toBe('/loginfoo'); // a different path that merely starts with "login"
  });

  it('uses the given fallback', () => {
    expect(safeReturnUrl('https://evil.example', '/home')).toBe('/home');
  });
});
