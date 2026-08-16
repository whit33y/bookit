import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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

/** Kroki sekcji „Jak to działa" jako dane — trzy karty różnią się wyłącznie treścią. */
const HOW_STEPS = [
  { titleKey: 'landing.how.step1.title', textKey: 'landing.how.step1.text' },
  { titleKey: 'landing.how.step2.title', textKey: 'landing.how.step2.text' },
  { titleKey: 'landing.how.step3.title', textKey: 'landing.how.step3.text' },
] as const satisfies readonly { titleKey: TranslationKey; textKey: TranslationKey }[];

/** Wspólna miara i padding wszystkich sekcji strony — ta sama siatka co pasek nawigacji (#125). */
const SECTION_CLASS = 'mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16';

/** Placeholdery kategorii na czas ładowania. Tyle, ile liczy zasiany zestaw kategorii
 *  (`prisma/seed/demo-data.ts`) — dwa wiersze na `lg`, więc rezerwacja miejsca trafia
 *  w typową odpowiedź API zamiast zgadywać jeden kafelek. */
const CATEGORY_PLACEHOLDERS = [1, 2, 3, 4, 5, 6, 7, 8];

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  template: `
    <!-- Hero. Tło to delikatny tint marki, nie gradient sygnaturowy: biel na jego jasnym końcu
         (#F97316) daje 2.7:1, a WCAG AA wymaga 4.5:1. Gradient wchodzi więc jako dekoracyjny
         pasek nad nagłówkiem, tekst zostaje ciemny na tincie (~15:1). -->
    <section class="bg-gradient-to-b from-brand-50 via-stone-50 to-stone-50">
      <div [class]="sectionClass">
        <span
          aria-hidden="true"
          class="mb-6 block h-1 w-16 rounded-full bg-brand-gradient"
        ></span>
        <p class="text-sm font-semibold text-brand-700">
          {{ i18n.t('landing.tagline') }}
        </p>
        <h1
          class="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight text-stone-900 sm:text-5xl"
        >
          {{ i18n.t('landing.hero.title') }}
        </h1>
        <p class="mt-4 max-w-2xl text-[15px] leading-relaxed text-stone-600 sm:text-lg">
          {{ i18n.t('landing.hero.subtitle') }}
        </p>

        <form
          class="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-stone-200 bg-white p-6 text-left shadow-lifted sm:p-8"
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
    </section>

    <!-- Kategorie. Znikają w całości, gdy /categories padnie — lista jest wtedy pusta, a sam
         formularz działa dalej bez filtra kategorii (komunikat zostaje przy selekcie).
         W trakcie ładowania sekcja stoi już z placeholderami: gdyby wskakiwała dopiero
         z odpowiedzią, „Jak to działa" i CTA zjeżdżałyby w dół o kilkaset pikseli
         w połowie renderu — i klik użytkownika trafiałby w coś innego niż celował. -->
    @if (categoriesLoading() || categories().length) {
      <section
        aria-labelledby="landing-categories-h"
        [attr.aria-busy]="categoriesLoading() || null"
        [class]="sectionClass"
      >
        <h2
          id="landing-categories-h"
          class="mb-6 text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {{ i18n.t('landing.categories.title') }}
        </h2>
        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @if (categoriesLoading()) {
            @for (placeholder of categoryPlaceholders; track placeholder) {
              <!-- ten sam p-5 i wysokość wiersza co kafelek niżej, więc podmiana nie rusza layoutu -->
              <li
                aria-hidden="true"
                class="rounded-xl border border-stone-200 bg-white p-5 shadow-card"
              >
                <span class="block h-5 w-24 animate-pulse rounded bg-stone-100"></span>
              </li>
            }
          } @else {
            @for (c of categories(); track c.id) {
              <li>
                <a
                  routerLink="/search"
                  [queryParams]="{ category: c.slug }"
                  class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-5 text-sm font-semibold shadow-card transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  {{ c.name }}
                  <span aria-hidden="true" class="text-stone-400">›</span>
                </a>
              </li>
            }
          }
        </ul>
      </section>
    }

    <section aria-labelledby="landing-how-h" [class]="sectionClass">
      <h2
        id="landing-how-h"
        class="mb-6 text-2xl font-bold tracking-tight sm:text-3xl"
      >
        {{ i18n.t('landing.how.title') }}
      </h2>
      <ol class="grid gap-5 sm:grid-cols-3">
        @for (step of howSteps; track step.titleKey; let i = $index) {
          <li class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <span
              aria-hidden="true"
              class="mb-4 grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-200"
            >
              {{ i + 1 }}
            </span>
            <h3 class="text-lg font-bold">{{ i18n.t(step.titleKey) }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-stone-500">
              {{ i18n.t(step.textKey) }}
            </p>
          </li>
        }
      </ol>
    </section>

    <section aria-labelledby="landing-business-h" [class]="sectionClass">
      <div
        class="rounded-2xl bg-brand-50 p-8 ring-1 ring-inset ring-brand-200 sm:p-10"
      >
        <h2
          id="landing-business-h"
          class="text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {{ i18n.t('landing.business.title') }}
        </h2>
        <p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-stone-600">
          {{ i18n.t('landing.business.text') }}
        </p>
        <!-- /register, nie /create-business: CTA mówi do niezalogowanych, a trasa zakładania
             firmy jest za authGuard i odesłałaby ich na goły formularz logowania. returnUrl
             obsługują obie strony — guestGuard przepuszcza zalogowanego prosto na cel,
             a rejestracja wraca tam po założeniu konta. -->
        <a
          routerLink="/register"
          [queryParams]="{ returnUrl: '/create-business' }"
          class="mt-6 inline-flex rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          {{ i18n.t('landing.business.cta') }}
        </a>
      </div>
    </section>
  `,
})
export default class Landing {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly router = inject(Router);
  private readonly geolocation = inject(GeolocationService);

  protected readonly howSteps = HOW_STEPS;
  protected readonly sectionClass = SECTION_CLASS;
  protected readonly categoryPlaceholders = CATEGORY_PLACEHOLDERS;

  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesLoading = signal(true);
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
      })
      .finally(() => this.categoriesLoading.set(false));
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
