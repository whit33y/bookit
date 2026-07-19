import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';

/** Wyciąga polski komunikat z odpowiedzi błędu API. Błędy biznesowe (401/403/409)
 *  mają pojedynczy polski string; walidacyjne 400 mają message: string[] po angielsku
 *  (domyślne komunikaty class-validator) — te zastępujemy ogólnym polskim fallbackiem. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse && typeof err.error?.message === 'string') {
    return err.error.message;
  }
  return 'Coś poszło nie tak. Spróbuj ponownie.';
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

  delete<T>(path: string) {
    return this.http.delete<T>(this.base + path);
  }
}
