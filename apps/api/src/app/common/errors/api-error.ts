/**
 * Jeden kształt odpowiedzi błędu dla całego API (#45). Każdy błąd — nasz `throw new
 * NotFoundException(...)`, 400 z `ValidationPipe`, 404 na nieznanej trasie czy nieprzewidziany
 * wyjątek z Prismy — wychodzi z aplikacji jako `ApiErrorBody`. Składa go `ApiExceptionFilter`.
 */

/** Stabilny kod maszynowy błędu — front rozgałęzia się po nim zamiast po treści komunikatu. */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_ENTITY'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

/** Pojedyncze pole odrzucone przez walidację DTO. */
export interface ApiErrorField {
  /** Ścieżka pola w body, z zagnieżdżeniami: `email`, `slots.0.startTime`. */
  field: string;
  /** Klucze ograniczeń class-validatora (`isEmail`, `minLength`) — nie proza, żeby koperta
   *  została jednojęzyczna; komunikat dla użytkownika jest w `message`. */
  constraints: string[];
}

export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  /** Zawsze pojedynczy polski komunikat gotowy do pokazania użytkownikowi. */
  message: string;
  /** Tylko dla `VALIDATION_FAILED`. */
  fields?: ApiErrorField[];
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  // wgrywanie obrazów firmy (#153): za duży plik, nieobsługiwany format, treść nie do odczytania
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

export const codeForStatus = (status: number): ApiErrorCode =>
  CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');

/** Komunikat, gdy wyjątek nie niesie własnego (albo niesie angielską domyślkę frameworka). */
export const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: 'Przesłane dane są nieprawidłowe.',
  BAD_REQUEST: 'Nieprawidłowe żądanie.',
  UNAUTHORIZED: 'Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.',
  FORBIDDEN: 'Nie masz uprawnień do tej operacji.',
  NOT_FOUND: 'Nie znaleziono zasobu.',
  CONFLICT: 'Dane zmieniły się w międzyczasie. Odśwież stronę i spróbuj ponownie.',
  PAYLOAD_TOO_LARGE: 'Przesłany plik jest za duży.',
  UNSUPPORTED_MEDIA_TYPE: 'Nieobsługiwany format pliku.',
  UNPROCESSABLE_ENTITY: 'Nie udało się przetworzyć przesłanych danych.',
  TOO_MANY_REQUESTS: 'Zbyt wiele prób. Spróbuj ponownie za chwilę.',
  INTERNAL_ERROR: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
};
