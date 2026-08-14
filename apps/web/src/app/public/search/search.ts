import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { numberFormat } from '../../core/i18n/intl';
import { translate } from '../../core/i18n/translate';
import AppMap, { MapPin } from '../../shared/map/map';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';
import RatingStars from '../../shared/ui/rating-stars';

interface SearchResultItem {
  id: string;
  slug: string;
  name: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  category: { id: string; name: string; slug: string };
  distanceKm?: number;
  // agregat recenzji (#47); null to „brak ocen", nigdy 0 — AC #49 zakazuje atrapy „0.0"
  avgRating: number | null;
  reviewCount: number;
}

interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
}

// parametry przepuszczane 1:1 do GET /businesses; lat/lng/radiusKm nie mają jeszcze
// UI na tej stronie (dochodzi w #36), ale link z tymi parametrami już musi działać
const PASSTHROUGH_PARAMS = ['category', 'city', 'q', 'lat', 'lng', 'radiusKm', 'page'];

@Component({
  selector: 'app-search',
  imports: [AppMap, RouterLink, LoadingState, ErrorState, EmptyState, RatingStars],
  template: `
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row">
      <section class="lg:w-3/5">
        @if (loading()) {
          <app-loading-state
            [message]="i18n.t('search.loading')"
            paddingClass="py-16 text-center"
          />
        } @else if (serverError(); as msg) {
          <app-error-state [message]="msg" [retryable]="true" (retry)="retry()" />
        } @else if (items().length === 0) {
          <app-empty-state
            [title]="i18n.t('search.empty.title')"
            [description]="i18n.t('search.empty.description')"
            [boxed]="true"
          >
            <a
              routerLink="/"
              class="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline"
            >
              {{ i18n.t('search.empty.backLink') }}
            </a>
          </app-empty-state>
        } @else {
          <p class="mb-4 text-sm text-stone-500">
            {{ i18n.plural('search.resultCount', total()) }}
          </p>
          <ul class="flex flex-col gap-4">
            @for (item of items(); track item.id) {
              <li
                [id]="'card-' + item.id"
                tabindex="0"
                (mouseenter)="onCardFocus(item.id)"
                (focus)="onCardFocus(item.id)"
                class="rounded-xl border p-4 shadow-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                [class]="
                  activeId() === item.id
                    ? 'border-brand-600 ring-2 ring-brand-ring'
                    : 'border-stone-200'
                "
              >
                <a [routerLink]="'/' + item.slug" class="block">
                  <h2 class="font-bold">{{ item.name }}</h2>
                  <!-- firma bez ocen nie dostaje atrapy „0,0" (AC #49) — backend zwraca tu null -->
                  @if (item.avgRating !== null) {
                    <app-rating-stars
                      class="mt-1"
                      [value]="item.avgRating"
                      [count]="item.reviewCount"
                    />
                  }
                  <p class="mt-1 text-sm text-stone-500">
                    {{ item.category.name }} · {{ item.city }}, {{ item.street }}
                    @if (item.distanceKm !== undefined) {
                      · {{ distanceLabel(item.distanceKm) }}
                    }
                  </p>
                </a>
              </li>
            }
          </ul>

          @if (total() > limit()) {
            <div class="mt-6 flex items-center justify-between">
              <button
                type="button"
                [disabled]="!hasPrevPage()"
                (click)="goToPage(page() - 1)"
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
              >
                {{ i18n.t('search.previous') }}
              </button>
              <span class="text-sm text-stone-500">{{
                i18n.t('search.page', { page: page() })
              }}</span>
              <button
                type="button"
                [disabled]="!hasNextPage()"
                (click)="goToPage(page() + 1)"
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
              >
                {{ i18n.t('search.next') }}
              </button>
            </div>
          }
        }
      </section>

      <section class="lg:w-2/5">
        <app-map
          class="lg:sticky lg:top-[calc(var(--app-header-h)+1.5rem)]"
          heightClass="h-[28rem]"
          [ariaLabel]="i18n.t('search.mapLabel')"
          [pins]="mapPins()"
          [activeId]="activeId()"
          [userLocation]="userLocation()"
          (pinClick)="onPinClick($event)"
        />
      </section>
    </div>
  `,
})
export default class Search {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  protected readonly items = signal<SearchResultItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = signal(20);
  protected readonly activeId = signal<string | null>(null);
  protected readonly userLocation = signal<{ lat: number; lng: number } | null>(null);

  protected readonly mapPins = computed<MapPin[]>(() =>
    this.items().map((i) => ({ id: i.id, lat: i.lat, lng: i.lng })),
  );
  protected readonly hasPrevPage = computed(() => this.page() > 1);
  protected readonly hasNextPage = computed(
    () => this.page() * this.limit() < this.total(),
  );

  // rośnie przy każdym load() — pozwala odrzucić odpowiedź na nieaktualne już
  // zapytanie (np. dwa szybkie kliknięcia paginacji w złej kolejności sieciowej)
  private requestId = 0;
  // ostatnio użyte parametry — retry po błędzie sieci powtarza dokładnie to zapytanie,
  // bez ruszania adresu (nawigacja na te same query params nie wywołałaby load())
  private lastParams: ParamMap | null = null;

  constructor() {
    // queryParamMap (nie snapshot) — link z innymi filtrami musi odświeżyć wyniki
    // bez przeładowania komponentu
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.load(params));
  }

  protected retry(): void {
    if (this.lastParams) {
      this.load(this.lastParams);
    }
  }

  private load(params: ParamMap): void {
    const requestId = ++this.requestId;
    this.lastParams = params;
    this.loading.set(true);
    this.serverError.set(null);
    this.activeId.set(null);
    // czyścimy od razu — inaczej mapa i licznik pokazywałyby wyniki poprzedniego
    // zapytania, dopóki nowe się nie skończy (niespójne z "Szukam…" na liście)
    this.items.set([]);
    this.total.set(0);
    this.userLocation.set(this.parseUserLocation(params));

    const qp = new URLSearchParams();
    for (const key of PASSTHROUGH_PARAMS) {
      const value = params.get(key);
      if (value) {
        qp.set(key, value);
      }
    }
    const query = qp.toString();

    firstValueFrom(
      this.api.get<SearchResponse>('/businesses' + (query ? '?' + query : '')),
    )
      .then((res) => {
        if (requestId !== this.requestId) {
          return; // odpowiedź na już nieaktualne zapytanie — pomijamy
        }
        this.items.set(res.items);
        this.total.set(res.total);
        this.page.set(res.page);
        this.limit.set(res.limit);
      })
      .catch((err) => {
        if (requestId !== this.requestId) {
          return;
        }
        this.serverError.set(apiErrorMessage(err));
        this.items.set([]);
        this.total.set(0);
      })
      .finally(() => {
        if (requestId === this.requestId) {
          this.loading.set(false);
        }
      });
  }

  private parseUserLocation(
    params: ParamMap,
  ): { lat: number; lng: number } | null {
    const latParam = params.get('lat');
    const lngParam = params.get('lng');
    // puste stringi traktujemy jak brak parametru — spójnie z load(), które
    // przez `if (value)` i tak nie wyśle pustego lat/lng do API
    if (!latParam || !lngParam) {
      return null;
    }
    const lat = Number(latParam);
    const lng = Number(lngParam);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return null;
    }
    // ten sam zakres co walidacja lat/lng w apps/api businesses.service.ts —
    // spoza zakresu backend i tak odrzuci zapytaniem 400, mapa nie powinna
    // wcześniej wyrenderować markera w bezsensownym miejscu
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return { lat, lng };
  }

  protected onPinClick(id: string): void {
    this.activeId.set(id);
    // scrollIntoView brakuje w jsdom (środowisko testowe) — optional call zamiast
    // optional chaining na elemencie, żeby nie wysypać handlera w testach
    document.getElementById('card-' + id)?.scrollIntoView?.({
      block: 'nearest',
      behavior: 'smooth',
    });
  }

  protected onCardFocus(id: string): void {
    this.activeId.set(id);
  }

  /** Jedno miejsce po przecinku, separator wg języka UI — „1,4 km" / „1.4 km". */
  protected distanceLabel(km: number): string {
    return translate('search.distance', {
      distance: numberFormat({
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(km),
    });
  }

  protected goToPage(page: number): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }
}
