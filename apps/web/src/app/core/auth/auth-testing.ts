import type { HttpTestingController } from '@angular/common/http/testing';
import type { AuthUser, UserProfile } from './auth-store';

/**
 * Pomocniki testowe do profilu, który `AuthStore` pobiera dla każdego zalogowanego (#161).
 *
 * Mieszkają obok store'u, a nie w spekach: żądanie leci z każdego zalogowanego kontekstu, więc
 * dotyka kilkunastu plików, które o profilu nic nie mówią.
 */

/** Access token bez podpisu — `AuthStore` czyta wyłącznie payload, więc testowi wystarczy
 *  poprawny base64 w środkowym segmencie. */
export function fakeAccessToken(user: Partial<AuthUser> = {}): string {
  const payload: AuthUser = {
    sub: 'u1',
    email: 'anna.kowalska@firma.pl',
    role: 'CLIENT',
    ...user,
  };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

/** Zalogowanie testowego kontekstu: token w `localStorage`, tak jak po odtworzeniu sesji.
 *  Rola bierze się właśnie stąd, więc ekrany zależne od roli ustawia się tą jedną funkcją. */
export function signInAs(user: Partial<AuthUser> = {}): void {
  localStorage.setItem('bookit.accessToken', fakeAccessToken(user));
}

/** Odpowiedź `GET /users/me` — pełny kształt kontraktu, testy nadpisują tylko to, co badają. */
export function profileResponse(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: '1',
    email: 'anna.kowalska@firma.pl',
    firstName: 'Anna',
    lastName: 'Kowalska',
    phone: null,
    role: 'CLIENT',
    isBlocked: false,
    mustChangePassword: false,
    avatarVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `verify()` dla testów, które badają co innego niż profil: kwituje `GET /users/me` i dopiero
 * potem sprawdza, czy nie zostało nic otwartego.
 *
 * Pobranie profilu jest ciche (brak odpowiedzi zostawia `profile()` pustym), więc nieskwitowane
 * żądanie niczego nie psuje — bez tego jednak każdy `verify()` w zalogowanym kontekście
 * wywracałby się na nim.
 */
export function verifyIgnoringProfile(http: HttpTestingController): void {
  http.match('/api/users/me');
  http.verify();
}
