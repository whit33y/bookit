import { ParamMap } from '@angular/router';

/** Filtr blokady w URL i w API — backend (`AdminBusinessesQueryDto`) przyjmuje wyłącznie
 *  literały 'true'/'false'; brak parametru znaczy „pokaż jedne i drugie". */
export type BlockedFilter = 'true' | 'false' | null;

/** Odczytane z URL parametry listy admina, już zwalidowane pod kontrakt backendu. */
export interface AdminListParams {
  /** Fraza wyszukiwania; pusty string = brak filtra (do API nie trafi w ogóle). */
  q: string;
  blocked: BlockedFilter;
  /** null dla pierwszej strony — nie zaśmiecamy URL-a ani query domyślną wartością. */
  page: number | null;
}

// backend przycina `q` do 100 znaków (@MaxLength) — dłuższa fraza to 400, więc ucinamy
// po naszej stronie zamiast wysyłać zapytanie skazane na błąd
export const MAX_QUERY_LENGTH = 100;

// lustro MAX_PAGE z apps/api/src/app/common/pagination.ts — powyżej backend odpowiada 400
export const MAX_PAGE = 100_000;

/**
 * Wyciąga parametry listy z `queryParamMap`. Wszystko, co nie pasuje do kontraktu
 * backendu (`blocked` spoza true/false, `page` niebędące dodatnią liczbą całkowitą),
 * jest po cichu pomijane — URL bywa wpisany ręcznie albo pochodzi ze starego linku,
 * a to nie powód, żeby pokazać adminowi błąd 400 zamiast listy.
 */
export function readListParams(params: ParamMap): AdminListParams {
  const blocked = params.get('blocked');
  const page = Number(params.get('page'));

  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    blocked: blocked === 'true' || blocked === 'false' ? blocked : null,
    // strona 1 to wartość domyślna backendu — traktujemy ją jak brak parametru; powyżej
    // MAX_PAGE backend zwróciłby 400, więc taki URL też traktujemy jak brak parametru
    page: Number.isInteger(page) && page > 1 && page <= MAX_PAGE ? page : null,
  };
}

/**
 * Buduje querystring do `GET /admin/{businesses|users}`. Globalny `ValidationPipe` działa
 * z `forbidNonWhitelisted`, więc każdy nieznany klucz kończy się kodem 400 — dlatego
 * querystring powstaje wyłącznie z pól `AdminListParams`, nigdy przez przepisanie URL-a.
 * Puste `q` jest pomijane, a nie wysyłane jako `q=` (backend odrzuca je przez @IsNotEmpty).
 */
export function buildListQuery(params: AdminListParams): string {
  const query = new URLSearchParams();
  if (params.q) {
    query.set('q', params.q);
  }
  if (params.blocked) {
    query.set('blocked', params.blocked);
  }
  if (params.page) {
    query.set('page', String(params.page));
  }
  return query.toString();
}

/** Ścieżka z querystringiem gotowa dla `ApiClient` (bez prefiksu /api). */
export function adminListPath(resource: string, params: AdminListParams): string {
  const query = buildListQuery(params);
  return `/admin/${resource}` + (query ? '?' + query : '');
}
