/**
 * The login page can be told where to go after signing in (?returnUrl=/notes/123). That value comes
 * from the address bar, so anyone can put anything there: a link such as
 * /login?returnUrl=https://evil.example would send a freshly signed-in user to another website
 * ("open redirect"). Only paths INSIDE this app are accepted.
 */
export function safeReturnUrl(value: unknown, fallback = '/notes'): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  // Must be a path on this site: starts with ONE slash. "//host" and "/\host" are read by browsers
  // as another host, and anything with a scheme ("https:", "javascript:") does not start with "/".
  const isLocalPath = value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
  const hasControlCharacters = /[\u0000-\u001f]/.test(value);
  // Never go back to the auth pages themselves (a loop).
  const isAuthPage = /^\/(login|register)(\/|\?|#|$)/.test(value);
  return isLocalPath && !hasControlCharacters && !isAuthPage ? value : fallback;
}
