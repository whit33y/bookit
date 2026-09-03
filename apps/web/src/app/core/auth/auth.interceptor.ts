import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth-store';

/**
 * Komunikat, którym strażnik backendu odrzuca żądanie konta z niezmienionym hasłem startowym
 * (#144, `JwtAuthGuard.assertPasswordChanged`). Porównanie z odpowiedzią serwera, nie tekst
 * dla użytkownika — celowo poza słownikiem (jak `EXPIRED_TOKEN_MESSAGE` w reset-password):
 * przetłumaczony przestałby pasować.
 *
 * Odróżnia to 403 spod flagi od zwykłego „brak uprawnień" (zła rola), które ma zostać
 * błędem żądania, a nie przenosić użytkownika na inny ekran.
 */
const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  'Musisz zmienić hasło, zanim zrobisz cokolwiek innego';

const isPasswordChangeRequired = (err: unknown) =>
  err instanceof HttpErrorResponse &&
  err.status === 403 &&
  err.error?.message === PASSWORD_CHANGE_REQUIRED_MESSAGE;

/**
 * Dokłada `Authorization: Bearer <accessToken>`; na 401 (poza /api/auth/*)
 * odświeża tokeny i ponawia żądanie. Nieudany refresh → wylogowanie.
 *
 * 403 spod wymuszonej zmiany hasła (#146) prowadzi na ekran zmiany hasła, a nie na
 * wylogowanie: sesja jest ważna, brakuje tylko jednej czynności.
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
      if (isPasswordChangeRequired(err)) {
        store.requirePasswordChange();
        return throwError(() => err);
      }
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      // 401 z samego auth (złe hasło, zużyty refresh token) nie jest wygasłą sesją
      if (!is401 || req.url.startsWith('/api/auth/')) {
        return throwError(() => err);
      }
      // logout przy nieudanym refreshu robi AuthStore (raz, mimo N równoległych 401);
      // błąd ponowionego żądania propaguje bez wylogowania
      return from(store.refresh()).pipe(switchMap(() => next(withToken(req))));
    }),
  );
};
