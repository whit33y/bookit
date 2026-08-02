import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { formatDate } from '../../shared/business-time';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';
import Pagination from '../../shared/ui/pagination';
import RatingStars from '../../shared/ui/rating-stars';

// lustrzane typy backendu — GET /businesses/:slug/reviews (#47).
// `author` przychodzi już zamaskowany („Anna K.") — front nie skraca nazwisk u siebie.
interface BusinessReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author: string;
}

interface BusinessReviewsResponse {
  items: BusinessReview[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Sekcja opinii na publicznym profilu firmy (#49). Osobny komponent, bo to drugie, niezależne
 * żądanie: profil ma już własne stany ładowania/błędu i nie może gasnąć przez to, że nie udało
 * się pobrać recenzji.
 *
 * Numer strony siedzi w sygnale, nie w `?page` — profil czyta z routera wyłącznie slug, a wpis
 * w historii przeglądarki na każde kliknięcie strony opinii psułby przycisk „wstecz" na karcie firmy.
 */
@Component({
  selector: 'app-business-reviews',
  imports: [RatingStars, Pagination, LoadingState, ErrorState, EmptyState],
  template: `
    <h2 class="mb-4 mt-8 text-lg font-bold">Recenzje</h2>

    @if (loading()) {
      <app-loading-state message="Ładowanie opinii…" />
    } @else if (serverError(); as msg) {
      <app-error-state [message]="msg" [retryable]="true" (retry)="onRetry()" />
    } @else if (items().length) {
      <ul class="divide-y divide-stone-100">
        @for (review of items(); track review.id) {
          <li class="py-4 first:pt-0">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <app-rating-stars [value]="review.rating" [showValue]="false" />
              <span class="text-sm font-semibold">{{ review.author }}</span>
              <span class="text-[13px] text-stone-400">{{ date(review.createdAt) }}</span>
            </div>
            @if (review.comment; as comment) {
              <p class="mt-1.5 text-sm leading-relaxed text-stone-600">{{ comment }}</p>
            }
          </li>
        }
      </ul>

      <app-pagination
        [page]="page()"
        [limit]="limit()"
        [total]="total()"
        itemsLabel="opinii"
        frameClass="mt-2"
        (pageChange)="goToPage($event)"
      />
    } @else {
      <app-empty-state title="Ta firma nie ma jeszcze opinii." />
    }
  `,
})
export default class BusinessReviews {
  readonly slug = input.required<string>();

  private readonly api = inject(ApiClient);

  // pełna data i godzina rozpycha wiersz opinii, a przy recenzji liczy się dzień, nie minuta
  protected readonly date = formatDate;

  protected readonly items = signal<BusinessReview[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly limit = signal(0);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);

  constructor() {
    // Angular reużywa instancję przy przejściu między dwoma profilami (:slug → :slug), więc
    // zmiana wejścia musi zresetować stronę — inaczej nowa firma otwiera się na stronie 3.
    // effect śledzi wyłącznie slug(); reszta w untracked, żeby zapisy nie wywołały go ponownie.
    effect(() => {
      const slug = this.slug();
      untracked(() => {
        this.page.set(1);
        void this.load(slug, 1);
      });
    });
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    void this.load(this.slug(), page);
  }

  protected onRetry(): void {
    void this.load(this.slug(), this.page());
  }

  private async load(slug: string, page: number): Promise<void> {
    this.loading.set(true);
    this.serverError.set(null);
    try {
      const res = await firstValueFrom(
        this.api.get<BusinessReviewsResponse>(
          `/businesses/${slug}/reviews?page=${page}`,
        ),
      );
      this.items.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
      // limit dyktuje serwer (domyślnie 20) — pasek stron liczy z niego zakres „21–40 z 47"
      this.limit.set(res.limit);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
