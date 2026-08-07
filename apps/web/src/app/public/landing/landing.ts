import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';
import { translate } from '../../core/i18n/translate';
import { GeolocationService } from '../../shared/geolocation';

interface Category {
  id: string;
  name: string;
  slug: string;
}

const GEO_ERROR_KEYS = {
  denied: 'landing.geo.error.denied',
  timeout: 'landing.geo.error.timeout',
  unavailable: 'landing.geo.error.unavailable',
} as const satisfies Record<string, TranslationKey>;

@Component({
  selector: 'app-landing',
  template: `
    <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-12 text-center">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Bookit</h1>
      <p class="mt-2 text-stone-500">{{ i18n.t('landing.tagline') }}</p>

      <form
        class="mt-8 w-full rounded-2xl border border-stone-200 bg-white p-6 text-left shadow-card"
        novalidate
        (submit)="onSubmit($event)"
      >
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label for="category" class="mb-1.5 block text-sm font-medium">
              {{ i18n.t('landing.field.category') }}
            </label>
            <select
              id="category"
              [value]="category()"
              (change)="onCategoryChange($event)"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="">{{ i18n.t('landing.category.all') }}</option>
              @for (c of categories(); track c.id) {
                <option [value]="c.slug">{{ c.name }}</option>
              }
            </select>
            @if (categoriesError(); as msg) {
              <p class="mt-1.5 text-[13px] font-medium text-rose-600">{{ msg }}</p>
            }
          </div>

          <div>
            <label for="city" class="mb-1.5 block text-sm font-medium">{{
              i18n.t('landing.field.city')
            }}</label>
            <input
              id="city"
              type="text"
              [value]="city()"
              (input)="onCityInput($event)"
              [placeholder]="i18n.t('landing.city.placeholder')"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>

          <div>
            <label for="q" class="mb-1.5 block text-sm font-medium">
              {{ i18n.t('landing.field.query') }}
            </label>
            <input
              id="q"
              type="text"
              [value]="q()"
              (input)="onQueryInput($event)"
              [placeholder]="i18n.t('landing.query.placeholder')"
              class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm placeholder-stone-400 shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            />
          </div>
        </div>

        <button type="submit" class="btn-primary mt-5">
          {{ i18n.t('landing.search') }}
        </button>

        <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
          <button
            type="button"
            [disabled]="geoLoading()"
            (click)="onUseMyLocation()"
            class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
          >
            {{
              geoLoading()
                ? i18n.t('landing.geo.locating')
                : i18n.t('landing.geo.useMyLocation')
            }}
          </button>

          <div>
            <label for="radiusKm" class="sr-only">{{
              i18n.t('landing.geo.radiusLabel')
            }}</label>
            <select
              id="radiusKm"
              [value]="radiusKm()"
              (change)="onRadiusChange($event)"
              class="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
            >
              <option value="5">5 km</option>
              <option value="10">10 km</option>
              <option value="25">25 km</option>
            </select>
          </div>
        </div>

        @if (geoError(); as msg) {
          <p class="mt-1.5 text-[13px] font-medium text-rose-600">{{ msg }}</p>
        }
      </form>
    </div>
  `,
})
export default class Landing {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly router = inject(Router);
  private readonly geolocation = inject(GeolocationService);

  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesError = signal<string | null>(null);
  protected readonly category = signal('');
  protected readonly city = signal('');
  protected readonly q = signal('');
  protected readonly radiusKm = signal('10');
  protected readonly geoLoading = signal(false);
  protected readonly geoError = signal<string | null>(null);

  constructor() {
    firstValueFrom(this.api.get<Category[]>('/categories'))
      .then((cats) => this.categories.set(cats))
      .catch((err) => {
        this.categories.set([]);
        // wyszukiwanie bez filtra kategorii nadal działa — błąd tylko informuje,
        // że lista kategorii akurat nie jest dostępna, nie blokuje formularza
        this.categoriesError.set(
          translate('landing.error.categories', { detail: apiErrorMessage(err) }),
        );
      });
  }

  protected onCategoryChange(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
  }

  protected onCityInput(event: Event): void {
    this.city.set((event.target as HTMLInputElement).value);
  }

  protected onQueryInput(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
  }

  protected onRadiusChange(event: Event): void {
    this.radiusKm.set((event.target as HTMLSelectElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.router.navigate(['/search'], { queryParams: this.baseQueryParams() });
  }

  protected async onUseMyLocation(): Promise<void> {
    this.geoError.set(null);
    this.geoLoading.set(true);
    try {
      const result = await this.geolocation.getCurrentPosition();
      if (!result.ok) {
        this.geoError.set(translate(GEO_ERROR_KEYS[result.reason]));
        return;
      }

      this.router.navigate(['/search'], {
        queryParams: {
          ...this.baseQueryParams(),
          lat: String(result.lat),
          lng: String(result.lng),
          radiusKm: this.radiusKm(),
        },
      });
    } catch {
      // getCurrentPosition() teoretycznie może odrzucić Promise zamiast zwrócić
      // { ok: false } (np. Permissions-Policy w iframe rzuca synchronicznie) —
      // bez try/catch geoLoading zostałby zablokowany na true na stałe
      this.geoError.set(translate(GEO_ERROR_KEYS.unavailable));
    } finally {
      this.geoLoading.set(false);
    }
  }

  private baseQueryParams(): Record<string, string> {
    const queryParams: Record<string, string> = {};
    if (this.category()) {
      queryParams['category'] = this.category();
    }
    if (this.city().trim()) {
      queryParams['city'] = this.city().trim();
    }
    if (this.q().trim()) {
      queryParams['q'] = this.q().trim();
    }
    return queryParams;
  }
}
