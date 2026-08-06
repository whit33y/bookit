import { Component, computed, inject, input, output } from '@angular/core';
import { I18nStore } from '../../core/i18n/i18n-store';

// ile numerów stron pokazujemy naraz — okno przesuwa się wokół bieżącej strony, żeby przy
// kilkuset stronach pasek nie rozjechał się poza szerokość tabeli
const WINDOW_SIZE = 5;

/**
 * Paginacja listy (design system §8): zakres pozycji + okno numerów stron.
 * Komponent czysto prezentacyjny — nie zna URL-a ani API, o zmianie strony informuje rodzica.
 */
@Component({
  selector: 'app-pagination',
  template: `
    @if (total() > limit()) {
      <nav
        [attr.aria-label]="i18n.t('pagination.label')"
        class="flex flex-wrap items-center justify-between gap-3 text-[13px] font-medium"
        [class]="frameClass()"
      >
        <p class="text-stone-500">
          {{
            i18n.t('pagination.range', {
              start: rangeStart(),
              end: rangeEnd(),
              total: total(),
              items: itemsLabel(),
            })
          }}
        </p>
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            [disabled]="page() <= 1"
            (click)="pageChange.emit(page() - 1)"
            class="rounded-md px-2.5 py-1.5 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent"
          >
            {{ i18n.t('pagination.previous') }}
          </button>
          @for (p of pages(); track p) {
            <button
              type="button"
              [attr.aria-label]="i18n.t('pagination.page', { page: p })"
              [attr.aria-current]="p === page() ? 'page' : null"
              (click)="pageChange.emit(p)"
              class="rounded-md px-2.5 py-1.5 tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              [class]="
                p === page()
                  ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-200'
                  : 'hover:bg-stone-100'
              "
            >
              {{ p }}
            </button>
          }
          <button
            type="button"
            [disabled]="page() >= pageCount()"
            (click)="pageChange.emit(page() + 1)"
            class="rounded-md px-2.5 py-1.5 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent"
          >
            {{ i18n.t('pagination.next') }}
          </button>
        </div>
      </nav>
    }
  `,
})
export default class Pagination {
  protected readonly i18n = inject(I18nStore);

  readonly page = input.required<number>();
  readonly limit = input.required<number>();
  readonly total = input.required<number>();
  /** Dopełniacz liczby mnogiej — „firm", „użytkowników", „opinii" (konstrukcja „z 24 …"). */
  readonly itemsLabel = input.required<string>();
  /** Osadzenie paska: domyślnie stopka tabeli (kreska u góry + padding karty), ale sekcja
   *  bez obramowania podaje własne klasy — ten sam zabieg co `paddingClass` w LoadingState. */
  readonly frameClass = input('border-t border-stone-200 px-4 py-3 sm:px-6');

  readonly pageChange = output<number>();

  // limit z API zawsze jest >= 1, ale dzielenie przez 0 przy nieoczekiwanej odpowiedzi
  // dałoby Infinity stron — taniej się zabezpieczyć niż debugować pusty pasek
  private readonly safeLimit = computed(() => Math.max(1, this.limit()));

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.safeLimit())),
  );

  protected readonly rangeStart = computed(
    () => (this.page() - 1) * this.safeLimit() + 1,
  );

  protected readonly rangeEnd = computed(() =>
    Math.min(this.page() * this.safeLimit(), this.total()),
  );

  protected readonly pages = computed(() => {
    const count = this.pageCount();
    const start = Math.max(
      1,
      Math.min(this.page() - Math.floor(WINDOW_SIZE / 2), count - WINDOW_SIZE + 1),
    );
    const end = Math.min(count, start + WINDOW_SIZE - 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}
