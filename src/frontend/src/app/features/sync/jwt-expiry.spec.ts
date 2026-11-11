import { expiresWithin } from './jwt-expiry';

/** A token with the given payload; header and signature are irrelevant for reading the expiry. */
const token = (payload: object) => {
  const part = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${part}.signature`;
};

describe('expiresWithin', () => {
  const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
  const inSeconds = (s: number) => Math.floor(NOW / 1000) + s;

  it('is false while there is plenty of time left', () => {
    expect(expiresWithin(token({ exp: inSeconds(600) }), 30_000, NOW)).toBe(false);
  });

  it('is true when less than the margin is left', () => {
    expect(expiresWithin(token({ exp: inSeconds(10) }), 30_000, NOW)).toBe(true);
  });

  it('is true for a token that has already expired', () => {
    expect(expiresWithin(token({ exp: inSeconds(-5) }), 30_000, NOW)).toBe(true);
  });

  it('reads base64url (the - and _ alphabet, no padding) correctly', () => {
    // "é" and "?" in the payload make the encoding contain characters that differ between base64 and base64url.
    expect(expiresWithin(token({ name: 'é?>>', exp: inSeconds(10) }), 30_000, NOW)).toBe(true);
  });

  it('does not guess when the token cannot be read: the server will say', () => {
    expect(expiresWithin('not-a-jwt', 30_000, NOW)).toBe(false);
    expect(expiresWithin('a.%%%.c', 30_000, NOW)).toBe(false);
    expect(expiresWithin(token({ no: 'exp' }), 30_000, NOW)).toBe(false);
    expect(expiresWithin(token({ exp: 'soon' }), 30_000, NOW)).toBe(false);
    expect(expiresWithin('', 30_000, NOW)).toBe(false);
  });
});
