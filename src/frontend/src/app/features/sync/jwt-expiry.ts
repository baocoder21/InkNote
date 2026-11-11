/**
 * Does this access token (a JWT) expire within `ms` milliseconds? The payload is the middle part, base64url
 * encoded JSON; its `exp` claim is the expiry in SECONDS since 1970. Only the expiry is read (the signature is
 * the server's business). A token that cannot be read is treated as "not expiring": the server will say.
 */
export function expiresWithin(token: string, ms: number, now: number = Date.now()): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return false;
    }
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const exp = (JSON.parse(atob(padded)) as { exp?: unknown }).exp;
    return typeof exp === 'number' && exp * 1000 - now <= ms;
  } catch {
    return false;
  }
}
