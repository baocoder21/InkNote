import { InjectionToken } from '@angular/core';

/**
 * Goes to another page with a FULL page load (not the Angular router), which throws away
 * everything held in memory: stores, the access token, anything left by the previous user.
 * Used when signing out, so the next person to sign in on this browser starts from nothing.
 *
 * An injection token so that tests can replace it (jsdom cannot navigate).
 */
export const HARD_NAVIGATE = new InjectionToken<(url: string) => void>('HARD_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});
