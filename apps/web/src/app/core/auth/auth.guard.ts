import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore, UserRole, homeFor } from './auth-store';

/** Wpuszcza tylko niezalogowanych (login/register); inaczej redirect na stronę domową roli.
 *  Wygasły access token nie blokuje /login — inaczej martwa sesja (wygasły też refresh)
 *  odcinałaby formularz logowania do czasu ręcznego wyczyszczenia localStorage. */
export const guestGuard: CanActivateFn = () => {
  const user = inject(AuthStore).user();
  const fresh =
    user !== null && (user.exp === undefined || user.exp * 1000 > Date.now());
  return fresh ? inject(Router).createUrlTree([homeFor(user.role)]) : true;
};

/** Wpuszcza tylko zalogowanych; inaczej redirect na /login. */
export const authGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  return store.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** Wpuszcza tylko zalogowanych z jedną z podanych ról; inaczej redirect na /login. */
export function roleGuard(...roles: UserRole[]): CanActivateFn {
  return () => {
    const role = inject(AuthStore).user()?.role;
    return role !== undefined && roles.includes(role)
      ? true
      : inject(Router).createUrlTree(['/login']);
  };
}
