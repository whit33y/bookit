import { Component, computed, input } from '@angular/core';

const MAX_RATING = 5;
const STAR_POSITIONS = [1, 2, 3, 4, 5] as const;

/**
 * Ocena tylko do odczytu (design system §11). Glify są `aria-hidden`, a całość niesie jedną
 * dostępną etykietę — pięć osobno czytanych „★" to szum, a sam kolor nigdy nie może być jedynym
 * nośnikiem informacji (WCAG 1.4.1), dlatego obok gwiazdek stoi liczba.
 *
 * `count` zostaje puste przy pojedynczej recenzji (#48) i dostaje liczbę opinii na profilu
 * firmy oraz kartach wyników (#49). Wejście przyjmuje wyłącznie `number`: backend zwraca
 * `avgRating: null` dla firm bez ocen i decyzję „nie pokazuj atrapy 0.0" podejmuje wywołujący.
 */
@Component({
  selector: 'app-rating-stars',
  host: { class: 'inline-block' },
  template: `
    <!-- role="img" jest tu warunkiem działania, nie ozdobą: aria-label na elemencie bez roli
         jest przez AT ignorowane (axe: aria-prohibited-attr), a że całe wnętrze jest
         aria-hidden, ocena zostałaby wtedy nieodczytana. -->
    <span
      role="img"
      class="inline-flex items-center gap-1.5"
      [attr.aria-label]="label()"
    >
      <span aria-hidden="true" class="text-amber-500">
        @for (position of positions; track position) {
          <span [class]="position <= filled() ? '' : 'text-stone-300'">
            {{ position <= filled() ? '★' : '☆' }}
          </span>
        }
      </span>
      @if (showValue()) {
        <span aria-hidden="true" class="text-sm font-semibold">
          {{ formattedValue() }}
        </span>
        <!-- porównanie z null, nie truthiness: przy count = 0 licznik zniknąłby z ekranu,
             a etykieta i tak mówiłaby „0 opinii" (ta sama reguła co w label()) -->
        @if (count() !== null) {
          <span aria-hidden="true" class="text-sm font-medium text-stone-400">
            ({{ count() }})
          </span>
        }
      }
    </span>
  `,
})
export default class RatingStars {
  readonly value = input.required<number>();
  readonly count = input<number | null>(null);
  readonly showValue = input(true);

  protected readonly positions = STAR_POSITIONS;

  /** Średnia bywa ułamkiem (#49) — półgwiazdek nie rysujemy, zaokrąglamy w górę od 0,5. */
  protected readonly filled = computed(() => Math.round(this.value()));

  protected readonly formattedValue = computed(() => formatRating(this.value()));

  protected readonly label = computed(() => {
    const base = `Ocena ${this.formattedValue()} na ${MAX_RATING}`;
    const total = this.count();
    return total === null ? base : `${base}, ${total} ${opinionsWord(total)}`;
  });
}

/** Przecinek dziesiętny i maksymalnie jedno miejsce po przecinku — jak w design systemie („4,9"). */
function formatRating(value: number): string {
  return value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
}

/** Polska odmiana: 1 opinia, 2–4 opinie, 5+ opinii (z wyjątkiem nastek: 12 opinii). */
function opinionsWord(count: number): string {
  if (count === 1) return 'opinia';
  const lastTwo = count % 100;
  const last = count % 10;
  const isTeen = lastTwo >= 12 && lastTwo <= 14;
  return !isTeen && last >= 2 && last <= 4 ? 'opinie' : 'opinii';
}
