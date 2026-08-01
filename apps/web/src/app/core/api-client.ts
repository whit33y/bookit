import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';

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

const GENERIC_MESSAGE = 'Coś poszło nie tak. Spróbuj ponownie.';

/** Komunikat, gdy odpowiedź nie jest naszą kopertą — proxy, gateway, brak sieci, HTML z 500. */
const STATUS_MESSAGES: Record<number, string> = {
  // status 0 to żądanie, które nie doszło: offline, DNS, CORS, ubity serwer dev
  0: 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.',
  400: 'Przesłane dane są nieprawidłowe.',
  401: 'Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.',
  403: 'Nie masz uprawnień do tej operacji.',
  404: 'Nie znaleziono zasobu.',
  409: 'Dane zmieniły się w międzyczasie. Odśwież stronę i spróbuj ponownie.',
  429: 'Zbyt wiele prób. Spróbuj ponownie za chwilę.',
  500: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
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
 * Polski komunikat dla użytkownika z dowolnego błędu HTTP. Backend gwarantuje kopertę
 * `{ statusCode, code, message }` z polskim `message` (#45) — bierzemy go tylko wtedy, gdy
 * odpowiedź faktycznie tak wygląda. Inaczej komunikat per status HTTP, na końcu ogólny fallback.
 * Dzięki temu do UI nie wycieka „Internal server error" ani strona błędu proxy.
 */
export function apiErrorMessage(err: unknown): string {
  const body = apiErrorBody(err);
  if (body) {
    return body.message;
  }
  if (err instanceof HttpErrorResponse) {
    return STATUS_MESSAGES[err.status] ?? GENERIC_MESSAGE;
  }
  return GENERIC_MESSAGE;
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
