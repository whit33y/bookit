import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import {
  AuthStore,
  CHANGE_PASSWORD_PATH,
  UserRole,
  homeFor,
  safeReturnUrl,
} from './auth-store';

/** Wpuszcza tylko niezalogowanych (login/register); inaczej redirect na returnUrl albo
 *  na stronę domową roli. Wygasły access token nie blokuje /login — inaczej martwa sesja
 *  (wygasły też refresh) odcinałaby formularz logowania do czasu ręcznego wyczyszczenia
 *  localStorage. */
export const guestGuard: CanActivateFn = (route) => {
  const user = inject(AuthStore).user();
  const fresh =
    user !== null && (user.exp === undefined || user.exp * 1000 > Date.now());
  if (!fresh) {
    return true;
  }
  // zalogowany trafił na /login?returnUrl=… (np. z drugiej karty) — wraca tam, nie na stronę roli
  const returnUrl = safeReturnUrl(route.queryParamMap.get('returnUrl'));
  const router = inject(Router);
  return returnUrl
    ? router.parseUrl(returnUrl)
    : router.createUrlTree([homeFor(user.role)]);
};

/** Wpuszcza tylko zalogowanych; inaczej redirect na /login z celem powrotu. */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(AuthStore);
  return store.isLoggedIn()
    ? true
    : inject(Router).createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url },
      });
};

/** Wpuszcza tylko zalogowanych z jedną z podanych ról; inaczej redirect na /login
 *  z celem powrotu (spójnie z authGuard — deep link przeżywa logowanie). */
export function roleGuard(...roles: UserRole[]): CanActivateFn {
  return (_route, state) => {
    const role = inject(AuthStore).user()?.role;
    return role !== undefined && roles.includes(role)
      ? true
      : inject(Router).createUrlTree(['/login'], {
          queryParams: { returnUrl: state.url },
        });
  };
}

/**
 * Konto z wymuszoną zmianą hasła (#146) nie wychodzi poza ekran zmiany hasła — dopóki jej
 * nie dokona, każda trasa odbija na `/change-password`. Guard siedzi na wszystkich trasach
 * najwyższego poziomu (patrz `app.routes.ts`), więc obejmuje też poddrzewa lazy.
 *
 * Sam ekran zmiany hasła przepuszcza — inaczej redirect wpadłby w pętlę.
 */
export const passwordChangeGuard: CanActivateFn = (_route, state) => {
  const store = inject(AuthStore);
  if (!store.mustChangePassword() || state.url.startsWith(CHANGE_PASSWORD_PATH)) {
    return true;
  }
  return inject(Router).createUrlTree([CHANGE_PASSWORD_PATH]);
};
