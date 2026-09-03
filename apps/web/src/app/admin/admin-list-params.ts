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

/** Lista bez żadnego filtra i na pierwszej stronie. */
export const EMPTY_LIST_PARAMS: AdminListParams = { q: '', blocked: null, page: null };

// backend przycina `q` do 100 znaków (@MaxLength) — dłuższa fraza to 400, więc ucinamy
// po naszej stronie zamiast wysyłać zapytanie skazane na błąd
export const MAX_QUERY_LENGTH = 100;

// lustro MAX_PAGE z apps/api/src/app/common/pagination.ts — powyżej backend odpowiada 400
export const MAX_PAGE = 100_000;

/** Czym dana lista admina różni się od pozostałych. */
export interface AdminListOptions {
  /** false dla list bez paska filtrów (kolejka zgłoszeń #145): `q` i `blocked` z URL-a są
   *  wtedy ignorowane. Sama kolejka zna tylko `page`, a ręcznie dopisany `blocked` skończyłby
   *  się kodem 400 (`AdminApplicationsQueryDto` nie ma takiego pola, a `ValidationPipe`
   *  działa z `forbidNonWhitelisted`). */
  filters?: boolean;
}

/**
 * Wyciąga parametry listy z `queryParamMap`. Wszystko, co nie pasuje do kontraktu
 * backendu (`blocked` spoza true/false, `page` niebędące dodatnią liczbą całkowitą),
 * jest po cichu pomijane — URL bywa wpisany ręcznie albo pochodzi ze starego linku,
 * a to nie powód, żeby pokazać adminowi błąd 400 zamiast listy.
 */
export function readListParams(
  params: ParamMap,
  options: AdminListOptions = {},
): AdminListParams {
  if (options.filters === false) {
    return { ...EMPTY_LIST_PARAMS, page: readPage(params) };
  }

  const blocked = params.get('blocked');

  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    blocked: blocked === 'true' || blocked === 'false' ? blocked : null,
    page: readPage(params),
  };
}

/** Strona 1 to wartość domyślna backendu — traktujemy ją jak brak parametru; powyżej
 *  MAX_PAGE backend zwróciłby 400, więc taki URL też traktujemy jak brak parametru. */
function readPage(params: ParamMap): number | null {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page > 1 && page <= MAX_PAGE ? page : null;
}

/**
 * Buduje querystring do list admina (`GET /admin/businesses`, `/users`,
 * `/business-applications`). Globalny `ValidationPipe` działa
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
