import { Component, computed, input } from '@angular/core';
import { pluralPl } from '../../shared/plural-pl';

/** Stopnie od najwyższego — histogram czyta się 5→1, jak wszędzie indziej w sieci. */
const RATINGS = [5, 4, 3, 2, 1] as const;

type Rating = (typeof RATINGS)[number];

/** Lustrzany typ backendu — `ratingDistribution` z GET /businesses/:slug/reviews (#111). */
export type RatingDistribution = Record<Rating, number>;

interface DistributionRow {
  rating: Rating;
  count: number;
  percent: number;
  label: string;
}

/**
 * Rozkład ocen 1–5 firmy w sekcji recenzji na profilu (#112). Liczby przychodzą gotowe z API
 * i opisują całą firmę — front celowo nie liczy histogramu z pobranej strony opinii, bo lista
 * jest stronicowana i taki rozkład podpisany jako rozkład całości pokazywałby nieprawdę (#111).
 */
@Component({
  selector: 'app-rating-distribution',
  template: `
    <!-- firma bez ani jednej oceny nie dostaje pięciu zerowych pasków — pusty histogram
         to sam szum, a nie informacja „brak opinii" -->
    @if (total()) {
      <!-- lista dostaje nazwę, bo w spisie elementów czytnika ekranu stoi obok listy opinii
           i bez niej obie są nierozróżnialne (AC: „całość ma sensowną etykietę") -->
      <ul aria-label="Rozkład ocen" class="mb-6 max-w-md space-y-1.5">
        @for (row of rows(); track row.rating) {
          <li>
            <!-- Wzorzec z ui/rating-stars.ts: wnętrze wiersza jest w całości aria-hidden,
                 a informację niesie jedna etykieta na role="img". Bez roli aria-label bywa
                 przez AT ignorowane (axe: aria-prohibited-attr), a wtedy wiersz przepadłby
                 dla czytnika ekranu. Na ekranie sam pasek też niczego nie niesie — liczba
                 i udział stoją obok niego (WCAG 1.4.1). -->
            <span role="img" [attr.aria-label]="row.label" class="flex items-center gap-3">
              <span
                aria-hidden="true"
                class="w-9 shrink-0 text-[13px] font-medium tabular-nums"
              >
                {{ row.rating }} <span class="text-amber-500">★</span>
              </span>
              <span
                aria-hidden="true"
                class="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"
              >
                <span
                  class="block h-full rounded-full bg-brand-700"
                  [style.width.%]="row.percent"
                ></span>
              </span>
              <span
                aria-hidden="true"
                class="w-20 shrink-0 text-right text-[13px] font-medium tabular-nums text-stone-500"
              >
                {{ row.count }} · {{ row.percent }}%
              </span>
            </span>
          </li>
        }
      </ul>
    }
  `,
})
export default class RatingDistributionChart {
  readonly distribution = input.required<RatingDistribution>();

  protected readonly total = computed(() =>
    RATINGS.reduce((sum, rating) => sum + this.count(rating), 0),
  );

  protected readonly rows = computed<DistributionRow[]>(() => {
    const total = this.total();
    return RATINGS.map((rating) => {
      const count = this.count(rating);
      // ta sama liczba idzie do szerokości paska i do tekstu obok — inaczej „7%" stałoby
      // przy pasku narysowanym na 6,8% i dwa nośniki tej samej informacji przeczyłyby sobie.
      // Dzielnik pilnowany tutaj, nie tylko przez `@if (total())` w szablonie: invariant ma
      // stać przy kodzie, który od niego zależy, żeby przeniesienie warunku nie dało „NaN%".
      const percent = total ? Math.round((count / total) * 100) : 0;
      return {
        rating,
        count,
        percent,
        label:
          `${rating} ${pluralPl(rating, 'gwiazdka', 'gwiazdki', 'gwiazdek')}: ` +
          `${count} ${pluralPl(count, 'opinia', 'opinie', 'opinii')}, ${percent}% ocen`,
      };
    });
  });

  /** `?? 0` na wypadek niepełnej odpowiedzi — brakujący stopień ma dać pusty pasek, nie NaN%. */
  private count(rating: Rating): number {
    return this.distribution()[rating] ?? 0;
  }
}
