import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-client';

const httpError = (status: number, error: unknown) =>
  new HttpErrorResponse({ status, error });

describe('apiErrorMessage', () => {
  it('bierze polski komunikat z koperty API', () => {
    const err = httpError(409, {
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Wybrany termin jest już zajęty',
    });

    expect(apiErrorMessage(err)).toBe('Wybrany termin jest już zajęty');
  });

  it('nie przepuszcza angielskiej odpowiedzi bez koperty', () => {
    // stary kształt Nesta: {statusCode, message, error} bez `code`
    const err = httpError(500, { statusCode: 500, message: 'Internal server error' });

    expect(apiErrorMessage(err)).toBe(
      'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
    );
  });

  it('rozpoznaje brak połączenia (status 0)', () => {
    const err = httpError(0, new ProgressEvent('error'));

    expect(apiErrorMessage(err)).toBe(
      'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.',
    );
  });

  it('ma komunikat dla limitu prób (429)', () => {
    expect(apiErrorMessage(httpError(429, 'Too Many Requests'))).toBe(
      'Zbyt wiele prób. Spróbuj ponownie za chwilę.',
    );
  });

  it('nie pokazuje treści odpowiedzi nie-JSON (HTML z proxy)', () => {
    const err = httpError(502, '<html><body>Bad Gateway</body></html>');

    expect(apiErrorMessage(err)).toBe('Coś poszło nie tak. Spróbuj ponownie.');
  });

  it('odrzuca tablicę komunikatów (message: string[]) i daje komunikat per status', () => {
    const err = httpError(400, {
      statusCode: 400,
      message: ['email must be an email'],
    });

    expect(apiErrorMessage(err)).toBe('Przesłane dane są nieprawidłowe.');
  });

  it('radzi sobie z błędem, który nie jest odpowiedzią HTTP', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('Coś poszło nie tak. Spróbuj ponownie.');
  });
});
