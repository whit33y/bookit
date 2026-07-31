import { Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { AdminListParams, adminListPath, readListParams } from './admin-list-params';
import { AdminFilters } from './admin-toolbar';

/** Koperta paginacji zwracana przez oba endpointy `GET /admin/*`. */
interface AdminListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

const EMPTY_PARAMS: AdminListParams = { q: '', blocked: null, page: null };

/** Stan listy admina wystawiany komponentowi (tylko do odczytu + intencje użytkownika). */
export interface AdminList<T> {
  readonly loading: Signal<boolean>;
  readonly serverError: Signal<string | null>;
  readonly items: Signal<readonly T[]>;
  readonly total: Signal<number>;
  readonly page: Signal<number>;
  readonly limit: Signal<number>;
  /** Parametry odczytane z URL — zasilają pasek filtrów. */
  readonly params: Signal<AdminListParams>;
  /** True, gdy pusty wynik jest skutkiem filtrów, a nie pustej bazy. */
  readonly filtered: Signal<boolean>;
  /** Powtarza zapytanie dla aktualnych parametrów — retry po nieudanym pobraniu. Nawigacja
   *  na te same query params nie wywołałaby load(), więc ponawiamy wprost. */
  reload(): void;
  /** Podmienia wiersz w miejscu, po odpowiedzi akcji zwracającej pełny obiekt. */
  replaceItem(item: T): void;
  /** Usuwa wiersz i koryguje licznik — gdy po akcji przestał pasować do aktywnego filtra. */
  removeItem(id: string): void;
  applyFilters(filters: AdminFilters): void;
  goToPage(page: number): void;
}

/**
 * Wspólny silnik obu tabel admina: URL (`?q&blocked&page`) jest jedynym źródłem prawdy, każda
 * jego zmiana przeładowuje listę. Ten sam wzorzec co `public/search/search.ts` — dzięki temu
 * link do przefiltrowanej listy działa, „wstecz" cofa filtr, a odświeżenie strony nic nie gubi.
 *
 * Wywoływać w kontekście wstrzykiwania (inicjalizacja pola komponentu) — używa `inject()`
 * i `takeUntilDestroyed()`.
 */
export function createAdminList<T extends { id: string }>(
  resource: string,
): AdminList<T> {
  const api = inject(ApiClient);
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  const loading = signal(true);
  const serverError = signal<string | null>(null);
  const items = signal<T[]>([]);
  const total = signal(0);
  const page = signal(1);
  const limit = signal(20);
  const params = signal<AdminListParams>(EMPTY_PARAMS);

  // rośnie przy każdym load() — odpowiedź na nieaktualne zapytanie (np. szybka zmiana strony
  // przy wolnej sieci) nie może nadpisać świeższych wyników
  let requestId = 0;

  function load(next: AdminListParams): void {
    const currentRequest = ++requestId;
    params.set(next);
    loading.set(true);
    serverError.set(null);
    // czyścimy od razu — inaczej licznik i wiersze pokazywałyby poprzedni filtr do czasu
    // odpowiedzi, mimo że nagłówek mówi już „Ładowanie…"
    items.set([]);
    total.set(0);

    firstValueFrom(
      api.get<AdminListResponse<T>>(adminListPath(resource, next)),
    )
      .then((res) => {
        if (currentRequest !== requestId) {
          return;
        }
        items.set(res.items);
        total.set(res.total);
        page.set(res.page);
        limit.set(res.limit);
      })
      .catch((err: unknown) => {
        if (currentRequest !== requestId) {
          return;
        }
        serverError.set(apiErrorMessage(err));
      })
      .finally(() => {
        if (currentRequest === requestId) {
          loading.set(false);
        }
      });
  }

  // queryParamMap, nie snapshot — komponent nie jest tworzony ponownie przy samej zmianie
  // parametrów, więc bez subskrypcji filtr z linku nie zadziałałby
  route.queryParamMap
    .pipe(takeUntilDestroyed())
    .subscribe((queryParams) => load(readListParams(queryParams)));

  return {
    loading: loading.asReadonly(),
    serverError: serverError.asReadonly(),
    items: items.asReadonly(),
    total: total.asReadonly(),
    page: page.asReadonly(),
    limit: limit.asReadonly(),
    params: params.asReadonly(),
    filtered: computed(() => params().q !== '' || params().blocked !== null),

    reload(): void {
      load(params());
    },

    replaceItem(item: T): void {
      items.update((list) => list.map((row) => (row.id === item.id ? item : row)));
    },

    removeItem(id: string): void {
      items.update((list) => list.filter((row) => row.id !== id));
      // licznik pochodzi z odpowiedzi serwera; bez korekty stopka paginacji mówiłaby
      // o jeden wynik za dużo, dopóki lista się nie przeładuje
      total.update((value) => Math.max(0, value - 1));
    },

    applyFilters(filters: AdminFilters): void {
      router.navigate([], {
        relativeTo: route,
        // null usuwa parametr z URL-a; page zawsze wraca do pierwszej strony, inaczej nowa
        // fraza wylądowałaby na stronie 5 wyników, których jest teraz 12
        queryParams: { q: filters.q || null, blocked: filters.blocked, page: null },
        queryParamsHandling: 'merge',
      });
    },

    goToPage(nextPage: number): void {
      router.navigate([], {
        relativeTo: route,
        queryParams: { page: nextPage > 1 ? nextPage : null },
        queryParamsHandling: 'merge',
      });
    },
  };
}
