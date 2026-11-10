import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './store/auth.store';

/**
 * A route guard decides whether the router may enter a route. This one keeps signed-out visitors
 * out of the app: they are sent to the login page, which remembers where they wanted to go.
 *
 * It only improves the experience (nobody sees a half-broken page). The real protection is on the
 * server: every API call needs a valid token, whatever the front end shows.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return auth.isSignedIn() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** The opposite: the login and register pages are pointless when already signed in. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return auth.isSignedIn() ? router.createUrlTree(['/notes']) : true;
};
