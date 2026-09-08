import { Service, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';

interface FavoriteIds {
  ids: string[];
}

/**
 * Zbiór identyfikatorów ulubionych firm zalogowanego klienta (#182) — z niego serce
 * w wyszukiwarce i na profilu firmy wie, czy jest zapalone.
 *
 * Zbiór zamiast pola `isFavorite` w wynikach wyszukiwarki to decyzja z ADR-0004:
 * `GET /businesses` zostaje publiczny i bezstanowy, a stan serca nakłada front.
 * Konsekwencja jest tutaj: to ten store, a nie odpowiedź serwera, pilnuje, żeby zbiór
 * nie rozjechał się ze stanem bazy.
 *
 * Osobno od komponentu serca, bo jedna sesja ma jeden zbiór, a serc na ekranie jest
 * dwadzieścia — i przetrwa on wyjście z wyszukiwarki na profil i z powrotem (ten sam
 * powód, dla którego istnieją PendingCountStore i NotificationsStore).
 */
@Service()
export class FavoritesStore {
  private readonly api = inject(ApiClient);
  private readonly authStore = inject(AuthStore);

  private readonly idsSignal = signal<ReadonlySet<string>>(new Set());

  /** Ulubione ma wyłącznie CLIENT (CONTEXT.md → „Ulubiona firma"), więc dla pozostałych ról
   *  i dla gościa nie ma o co pytać — `/favorites/ids` oddałby im 403. Publiczne, bo tę samą
   *  regułę czyta serce, decydując, czy w ogóle się narysować. */
  readonly canHaveFavorites = computed(
    () => this.authStore.user()?.role === 'CLIENT',
  );

  /** Właściciel zbioru: tożsamość klienta albo `null`. Keyowanie efektu na `sub`, a nie na
   *  samym `user()`, jest z `AuthStore` — wymiana tokenu co 15 minut oddaje nowy obiekt przy
   *  tym samym `sub`, więc bez tego zbiór pobierałby się w kółko. A że w kluczu jest tożsamość,
   *  a nie sama rola, przelogowanie klienta na klienta wymienia zbiór, zamiast zostawić
   *  poprzedni. */
  private readonly ownerId = computed(() =>
    this.canHaveFavorites() ? (this.authStore.user()?.sub ?? null) : null,
  );

  // strażnik wyścigu pobrania: odpowiedź na nieaktualne już `GET /favorites/ids`
  // (zmiana konta w trakcie) nie może wpisać cudzego zbioru
  private loadId = 0;
  // decyzje klienta podjęte, zanim wróciło pobranie — nakładamy je na zbiór z serwera,
  // bo są od niego świeższe. Odrzucenie całej odpowiedzi gasiłoby wszystkie pozostałe serca
  // do końca sesji, a poszła o jedno kliknięcie.
  private readonly pendingChanges = new Map<string, boolean>();
  // strażnik per firma: przy dwóch kliknięciach w to samo serce błąd starszego żądania
  // nie ma cofać nowszej decyzji klienta
  private readonly toggleIds = new Map<string, number>();

  constructor() {
    // Keyed na roli: odtworzenie sesji z localStorage i zalogowanie prowadzą do tego samego
    // pobrania, a wylogowanie zeruje zbiór. Stąd „raz na sesję klienta", a nie przy każdym
    // wejściu na wyszukiwarkę — store jest singletonem, ekrany tylko go czytają.
    effect(() => {
      if (this.ownerId() === null) {
        this.reset();
        return;
      }
      void this.refresh();
    });
  }

  isFavorite(businessId: string): boolean {
    return this.idsSignal().has(businessId);
  }

  /**
   * Cicho: zbiór jest dodatkiem do ekranu, a nie treścią, o którą klient poprosił. Nieudane
   * pobranie zostawia serca puste, zamiast przesłaniać wyszukiwarkę komunikatem o błędzie —
   * ten sam kompromis co przy liczniku powiadomień.
   */
  async refresh(): Promise<void> {
    if (!this.canHaveFavorites()) {
      this.reset();
      return;
    }
    const requestId = ++this.loadId;
    this.pendingChanges.clear();
    try {
      const { ids } = await firstValueFrom(this.api.get<FavoriteIds>('/favorites/ids'));
      if (requestId !== this.loadId) return;
      const merged = new Set(ids);
      for (const [businessId, isFavorite] of this.pendingChanges) {
        if (isFavorite) {
          merged.add(businessId);
        } else {
          merged.delete(businessId);
        }
      }
      this.pendingChanges.clear();
      this.idsSignal.set(merged);
    } catch {
      // patrz komentarz metody — brak zmiany stanu przy błędzie
    }
  }

  /**
   * Przełączenie serca. Optymistycznie: rysujemy nowy stan od razu, a żądanie leci w tle —
   * przy tak drobnej akcji czekanie na `204` wygląda na zacięcie interfejsu. Nieudane
   * żądanie cofa zmianę, więc serce nigdy nie zostaje w stanie, którego nie ma baza.
   */
  async toggle(businessId: string): Promise<void> {
    if (!this.canHaveFavorites()) return;

    const wasFavorite = this.isFavorite(businessId);
    const next = !wasFavorite;
    this.apply(businessId, next);

    const requestId = (this.toggleIds.get(businessId) ?? 0) + 1;
    this.toggleIds.set(businessId, requestId);
    const path = `/businesses/${businessId}/favorite`;
    try {
      await firstValueFrom(
        next ? this.api.put<void>(path, {}) : this.api.delete<void>(path),
      );
    } catch {
      // klient kliknął w międzyczasie jeszcze raz — jego decyzja jest świeższa niż ten błąd
      if (this.toggleIds.get(businessId) !== requestId) return;
      this.apply(businessId, wasFavorite);
    }
  }

  private apply(businessId: string, isFavorite: boolean): void {
    // zmiana lokalna jest świeższa niż pobranie w locie, więc przeżyje jego odpowiedź
    this.pendingChanges.set(businessId, isFavorite);
    this.idsSignal.update((ids) => {
      const next = new Set(ids);
      if (isFavorite) {
        next.add(businessId);
      } else {
        next.delete(businessId);
      }
      return next;
    });
  }

  private reset(): void {
    this.loadId++;
    this.toggleIds.clear();
    this.pendingChanges.clear();
    this.idsSignal.set(new Set());
  }
}
