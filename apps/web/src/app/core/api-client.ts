import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { currentLocale } from './i18n/locale';
import type { TranslationKey } from './i18n/pl';
import { translate } from './i18n/translate';

/** Lustro `ApiErrorCode` z apps/api (`common/errors/api-error.ts`) — repo nie ma wspólnej
 *  libki DTO, każdy typ kontraktu jest po stronie web powielony. */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

/** Lustro `ApiErrorBody` — kształt, który `ApiExceptionFilter` gwarantuje dla każdego błędu. */
export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  fields?: { field: string; constraints: string[] }[];
}

/** Komunikat, gdy odpowiedź nie jest naszą kopertą — proxy, gateway, brak sieci, HTML z 500. */
const STATUS_KEYS: Record<number, TranslationKey> = {
  // status 0 to żądanie, które nie doszło: offline, DNS, CORS, ubity serwer dev
  0: 'api.error.offline',
  400: 'api.error.badRequest',
  401: 'api.error.unauthorized',
  403: 'api.error.forbidden',
  404: 'api.error.notFound',
  409: 'api.error.conflict',
  429: 'api.error.tooManyRequests',
  500: 'api.error.server',
};

/** Odpowiednik `message` z koperty po naszej stronie — używany, gdy UI nie jest po polsku. */
const CODE_KEYS: Record<ApiErrorCode, TranslationKey> = {
  VALIDATION_FAILED: 'api.error.validation',
  BAD_REQUEST: 'api.error.badRequest',
  UNAUTHORIZED: 'api.error.unauthorized',
  FORBIDDEN: 'api.error.forbidden',
  NOT_FOUND: 'api.error.notFound',
  CONFLICT: 'api.error.conflict',
  TOO_MANY_REQUESTS: 'api.error.tooManyRequests',
  INTERNAL_ERROR: 'api.error.server',
};

/** Rozpoznaje kopertę z `ApiExceptionFilter`; wszystko inne (angielskie domyślki frameworka,
 *  HTML proxy, `message: string[]` starego ValidationPipe) świadomie nie przechodzi. */
function apiErrorBody(err: unknown): ApiErrorBody | null {
  if (!(err instanceof HttpErrorResponse)) {
    return null;
  }
  const body: unknown = err.error;
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ApiErrorBody).statusCode === 'number' &&
    typeof (body as ApiErrorBody).code === 'string' &&
    typeof (body as ApiErrorBody).message === 'string'
  ) {
    return body as ApiErrorBody;
  }
  return null;
}

/**
 * Komunikat dla użytkownika z dowolnego błędu HTTP, w języku UI. Backend gwarantuje kopertę
 * `{ statusCode, code, message }` z polskim `message` (#45) — bierzemy go tylko wtedy, gdy
 * odpowiedź faktycznie tak wygląda. Inaczej komunikat per status HTTP, na końcu ogólny fallback.
 * Dzięki temu do UI nie wycieka „Internal server error" ani strona błędu proxy.
 *
 * Przy EN `message` z serwera odrzucamy i tłumaczymy po maszynowym `code` (#57) — inaczej polskie
 * zdanie z backendu przeciekłoby do angielskiego interfejsu. Cena tej decyzji: EN traci
 * szczegółowość („Wybrany termin jest już zajęty" → ogólny komunikat konfliktu). Docelowo
 * rozwiąże to `Accept-Language` po stronie API; do tego czasu maile i treść powiadomień
 * też zostają po polsku.
 */
export function apiErrorMessage(err: unknown): string {
  const body = apiErrorBody(err);
  if (body) {
    // `code` przechodzi walidację jako dowolny string, więc mapa może go nie znać — nowy kod
    // po stronie API albo obca koperta o tym samym kształcie. Bez fallbacku translate() dostałoby
    // undefined i oddało pusty komunikat.
    const key = CODE_KEYS[body.code] ?? 'api.error.generic';
    return currentLocale() === 'pl' ? body.message : translate(key);
  }
  if (err instanceof HttpErrorResponse) {
    const key = STATUS_KEYS[err.status];
    return key ? translate(key) : translate('api.error.generic');
  }
  return translate('api.error.generic');
}

/**
 * Czy błąd to odpowiedź HTTP o jednym z podanych statusów. Dla ścieżek, które na status
 * *reagują*, a nie tylko pokazują komunikat: 404/409 z decyzji o zgłoszeniu znaczy „ktoś to
 * już rozpatrzył", więc wiersz wypada z kolejki zgłoszeń (#145).
 */
export function isApiStatus(err: unknown, ...statuses: number[]): boolean {
  return err instanceof HttpErrorResponse && statuses.includes(err.status);
}

/** Cienki wrapper na HttpClient z bazowym prefiksem /api (proxy dev → :3000). */
@Service()
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  get<T>(path: string) {
    return this.http.get<T>(this.base + path);
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(this.base + path, body);
  }

  patch<T>(path: string, body: unknown) {
    return this.http.patch<T>(this.base + path, body);
  }

  put<T>(path: string, body: unknown) {
    return this.http.put<T>(this.base + path, body);
  }

  delete<T>(path: string) {
    return this.http.delete<T>(this.base + path);
  }
}
