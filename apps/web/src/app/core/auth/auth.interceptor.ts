import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth-store';

/**
 * Dokłada `Authorization: Bearer <accessToken>`; na 401 (poza /api/auth/*)
 * odświeża tokeny i ponawia żądanie. Nieudany refresh → wylogowanie.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);

  const withToken = (r: HttpRequest<unknown>) => {
    const token = store.accessToken();
    return token
      ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : r;
  };

  return next(withToken(req)).pipe(
    catchError((err: unknown) => {
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      // 401 z samego auth (złe hasło, zużyty refresh token) nie jest wygasłą sesją
      if (!is401 || req.url.startsWith('/api/auth/')) {
        return throwError(() => err);
      }
      return from(store.refresh()).pipe(
        switchMap(() => next(withToken(req))),
        catchError((refreshErr: unknown) => {
          store.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
