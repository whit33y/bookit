import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore, UserRole } from './auth-store';

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
