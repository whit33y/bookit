import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { I18nStore } from '../core/i18n/i18n-store';
import { businessLogoUrl } from '../shared/business-image';
import BusinessLogo from '../shared/ui/business-logo';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';
import RatingStars from '../shared/ui/rating-stars';

/**
 * Pozycja `GET /favorites` (#181). To karta wyniku wyszukiwarki minus lat/lng — lista nie ma
 * mapy — plus `isAvailable`: „firma działająca" liczy backend, front nie składa jej ze
 * `status` i `isBlocked` (CONTEXT.md → „Ulubiona firma").
 */
export interface FavoriteBusiness {
  id: string;
  slug: string;
  name: string;
  city: string;
  street: string;
  logoVersion: string | null;
  category: { id: string; name: string; slug: string };
  // null to „brak ocen", nigdy 0 — firma bez opinii nie dostaje atrapy „0,0" (AC #49)
  avgRating: number | null;
  reviewCount: number;
  isAvailable: boolean;
}

/**
 * Lista firm oznaczonych sercem (#183). Kolejność — od ostatnio dodanych — i brak paginacji
 * przychodzą z API; komponent nie sortuje ani nie stronicuje.
 *
 * Karta jest ta sama co w wyniku wyszukiwarki (logo, nazwa, kategoria, miasto, ocena), żeby
 * klient rozpoznał to, co przed chwilą widział. Bez skrótu „Rezerwuj": wizard startuje od
 * wyboru usługi na profilu, więc przycisk obiecywałby jeden klik do terminu.
 *
 * Usunięcie leci przez `DELETE /businesses/:id/favorite`, a pozycja wypada z sygnału — bez
 * ponownego `GET /favorites`. Świadomie po odpowiedzi, nie optymistycznie: pozycja zniknęłaby
 * na chwilę i wróciła przy błędzie, a to na liście na kilka kart wygląda jak zgubione dane.
 */
@Component({
  selector: 'app-favorites',
  imports: [
    RouterLink,
    BusinessLogo,
    RatingStars,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  template: `
    <div class="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        {{ i18n.t('favorites.title') }}
      </h1>

      @if (loading()) {
        <app-loading-state class="mt-6" [message]="i18n.t('favorites.loading')" />
      } @else if (serverError(); as msg) {
        <!-- pusta lista i nieudane pobranie to dwie różne rzeczy: bez tej gałęzi klient
             z ulubionymi zobaczyłby „nie masz jeszcze ulubionych firm" po błędzie sieci -->
        <app-error-state
          class="mt-6"
          [message]="msg"
          [retryable]="true"
          (retry)="load()"
        />
      } @else if (items().length === 0) {
        <app-empty-state class="mt-6" [title]="i18n.t('favorites.empty.title')" [boxed]="true">
          <a
            routerLink="/search"
            class="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline"
          >
            {{ i18n.t('favorites.empty.searchLink') }}
          </a>
        </app-empty-state>
      } @else {
        @if (removeError(); as msg) {
          <app-error-state class="mt-6" [message]="msg" />
        }
        <ul class="mt-6 flex flex-col gap-4">
          @for (item of cards(); track item.id) {
            <!-- „wyszarzona" pozycja to tło i stonowany nagłówek, nigdy opacity na całej
                 karcie: przezroczystość zjada kontrast każdego napisu pod nią, a komunikat
                 o niedostępności musi zostać czytelny (WCAG AA 1.4.3). -->
            <li
              class="flex items-start gap-3 rounded-xl border p-4 shadow-card"
              [class]="
                item.isAvailable
                  ? 'border-stone-200 bg-white'
                  : 'border-stone-200 bg-stone-100'
              "
            >
              <!-- routerLink na null zostawia anchor bez href, czyli element nieklikalny
                   i poza kolejnością Tab — firma niedziałająca ma nie linkować nigdzie, bo jej
                   profil zwraca 404. Jeden anchor w dwóch stanach zamiast dwóch gałęzi
                   szablonu: karta jest ta sama, różni się tylko celem. -->
              <a
                [routerLink]="item.isAvailable ? '/' + item.slug : null"
                class="flex min-w-0 flex-1 items-start gap-4"
              >
                <app-business-logo
                  class="h-14 w-14 rounded-xl text-base font-bold sm:h-16 sm:w-16"
                  [class.opacity-60]="!item.isAvailable"
                  [name]="item.name"
                  [src]="item.logoUrl"
                />
                <!-- min-w-0: bez tego długa nazwa rozpycha kolumnę tekstu i wypycha
                     miniaturę poza kartę zamiast się zawinąć -->
                <div class="min-w-0 flex-1">
                  <h2 class="font-bold" [class.text-stone-600]="!item.isAvailable">
                    {{ item.name }}
                  </h2>
                  @if (item.avgRating !== null) {
                    <app-rating-stars
                      class="mt-1"
                      [value]="item.avgRating"
                      [count]="item.reviewCount"
                    />
                  }
                  <p class="mt-1 text-sm text-stone-500">
                    {{ item.category.name }} · {{ item.city }}, {{ item.street }}
                  </p>
                  @if (!item.isAvailable) {
                    <!-- nie mówimy, dlaczego: blokada to sprawa między firmą a administratorem -->
                    <p class="mt-1 text-sm font-semibold text-stone-700">
                      {{ i18n.t('favorites.unavailable') }}
                    </p>
                  }
                </div>
              </a>

              <button
                type="button"
                [attr.aria-label]="i18n.t('favorites.removeNamed', { name: item.name })"
                [disabled]="removing().has(item.id)"
                (click)="remove(item.id)"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:text-stone-300"
              >
                <!-- serce wypełnione: na tej liście każda pozycja jest ulubiona, więc klik
                     może znaczyć tylko „zdejmij" -->
                <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 21s-6.7-4.35-9.2-8.2C.6 9.5 2 5.5 5.5 4.4 7.8 3.7 10.2 4.6 12 6.6c1.8-2 4.2-2.9 6.5-2.2 3.5 1.1 4.9 5.1 2.7 8.4C18.7 16.65 12 21 12 21z"
                  />
                </svg>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export default class Favorites {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  /** Nieudane zdjęcie serca — osobno od `serverError`, bo lista dalej jest na ekranie. */
  protected readonly removeError = signal<string | null>(null);
  protected readonly items = signal<FavoriteBusiness[]>([]);
  /** Identyfikatory z żądaniem w locie — zbiór, a nie flaga: kart jest kilka i każda ma
   *  własne serce, więc jedno kliknięcie nie może wygasić pozostałych. */
  protected readonly removing = signal<ReadonlySet<string>>(new Set());

  /** Pozycje z gotowym adresem logo — kartę interesuje URL, nie hash wersji z API. */
  protected readonly cards = computed(() =>
    this.items().map((item) => ({ ...item, logoUrl: businessLogoUrl(item) })),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.serverError.set(null);
    this.removeError.set(null);
    firstValueFrom(this.api.get<FavoriteBusiness[]>('/favorites'))
      .then((favorites) => this.items.set(favorites))
      .catch((err) => {
        this.serverError.set(apiErrorMessage(err));
        this.items.set([]);
      })
      .finally(() => this.loading.set(false));
  }

  protected remove(businessId: string): void {
    if (this.removing().has(businessId)) {
      return;
    }
    this.removeError.set(null);
    this.removing.update((ids) => new Set(ids).add(businessId));

    firstValueFrom(this.api.delete<void>(`/businesses/${businessId}/favorite`))
      .then(() =>
        this.items.update((items) => items.filter((item) => item.id !== businessId)),
      )
      .catch((err) => this.removeError.set(apiErrorMessage(err)))
      .finally(() =>
        this.removing.update((ids) => {
          const next = new Set(ids);
          next.delete(businessId);
          return next;
        }),
      );
  }
}
