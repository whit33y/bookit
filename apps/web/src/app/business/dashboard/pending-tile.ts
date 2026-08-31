import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { formatDate, formatTime } from '../../shared/business-time';
import { CalendarBooking } from '../calendar/booking-details-dialog';
import { byStartsAt, mineBookingsUrl } from '../mine-bookings';
import { pendingRange } from '../pending-count-store';
import DashboardTile, { type TileState } from './dashboard-tile';

/** Ile oczekujących pokazuje próbka pod liczbą (#133: „2–3 najbliższe"). */
const PENDING_PREVIEW_LIMIT = 3;

/**
 * Kolejność próbki: najbliższe do rozpatrzenia. Najpierw terminy jeszcze przed firmą, od
 * najwcześniejszego — te wymagają decyzji zanim nadejdą. Dopiero za nimi zaległe, od
 * najświeższej: `pendingRange()` sięga 60 dni wstecz (oczekująca rezerwacja może dotyczyć
 * terminu z przeszłości, CONTEXT.md), więc samo sortowanie rosnąco wypełniłoby całą próbkę
 * najstarszymi zaległościami i firma nigdy nie zobaczyłaby prośby na jutro.
 */
function nearestPending(
  bookings: readonly CalendarBooking[],
  nowMs: number,
): CalendarBooking[] {
  const pending = bookings.filter((b) => b.status === 'PENDING');
  const upcoming = pending.filter(
    (b) => new Date(b.startsAt).getTime() >= nowMs,
  );
  const overdue = pending.filter((b) => new Date(b.startsAt).getTime() < nowMs);
  return [
    ...upcoming.sort(byStartsAt),
    ...overdue.sort((a, b) => byStartsAt(b, a)),
  ];
}

/** Jedna pozycja próbki, gotowa do wyświetlenia — jak w kafelku kalendarza, formatowanie
 *  siedzi w `computed()`, nie w szablonie. */
interface PendingItem {
  id: string;
  client: string;
  service: string;
  when: string;
}

/**
 * Kafelek oczekujących rezerwacji na pulpicie firmy (#133): liczba `PENDING` i próbka
 * najbliższych do rozpatrzenia.
 *
 * Zakres bierzemy z `pendingRange()` — tego samego, którym liczy plakietkę `PendingCountStore`
 * i którym pobiera listę `/business/pending`. Liczba na pulpicie i liczba w nawigacji muszą
 * się zgadzać, a oczekująca rezerwacja może dotyczyć terminu z przeszłości (CONTEXT.md), więc
 * okno sięga wstecz i nie da się go zwęzić do „od dziś".
 *
 * Żądanie świadomie dubluje to, które robi już `PendingCountStore`: kafelek potrzebuje samych
 * rezerwacji, nie tylko liczby, i ma własne stany ładowania/błędu — plakietka w nawigacji
 * milczy przy błędzie, kafelek musi go pokazać razem z ponowieniem.
 *
 * Rozpatrywanie zostaje na `/business/pending`: kafelek pokazuje, nie decyduje.
 */
@Component({
  selector: 'app-dashboard-pending-tile',
  imports: [DashboardTile],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.pending')"
      link="/business/pending"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      [emptyTitle]="i18n.t('businessDashboard.pendingEmpty')"
      [emptyCta]="i18n.t('businessDashboard.pendingCta')"
      (retry)="onRetry()"
    >
      <p class="font-semibold">
        {{ i18n.plural('businessDashboard.pendingWithCount', count()) }}
      </p>

      <ul class="mt-3 flex flex-col gap-2">
        @for (item of preview(); track item.id) {
          <li class="min-w-0">
            <span class="block truncate font-medium">{{ item.client }}</span>
            <span class="block truncate text-stone-600"
              >{{ item.service }} · {{ item.when }}</span
            >
          </li>
        }
      </ul>
    </app-dashboard-tile>
  `,
})
export default class PendingTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly bookings = signal<CalendarBooking[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  /** „Teraz" zamrożone na moment pobrania — dzieli próbkę na terminy przyszłe i zaległe. */
  protected readonly now = signal(Date.now());

  private readonly pending = computed(() =>
    nearestPending(this.bookings(), this.now()),
  );

  protected readonly count = computed(() => this.pending().length);

  protected readonly preview = computed<PendingItem[]>(() =>
    this.pending()
      .slice(0, PENDING_PREVIEW_LIMIT)
      .map((booking) => ({
        id: booking.id,
        client: `${booking.client.firstName} ${booking.client.lastName}`,
        service: booking.service.name,
        when: `${formatDate(booking.startsAt)}, ${formatTime(booking.startsAt)}`,
      })),
  );

  // brak oczekujących to stan pusty, nie „0" — AC #133
  protected readonly state = computed<TileState>(() => {
    if (this.loading()) return 'loading';
    if (this.serverError()) return 'error';
    return this.count() ? 'content' : 'empty';
  });

  constructor() {
    void this.load();
  }

  protected onRetry(): void {
    void this.load();
  }

  // bez strażnika wyścigu — patrz komentarz przy `load()` w calendar-tile.ts
  private async load(): Promise<void> {
    this.loading.set(true);
    this.serverError.set(null);
    this.now.set(Date.now());
    try {
      const bookings = await firstValueFrom(
        this.api.get<CalendarBooking[]>(mineBookingsUrl(pendingRange())),
      );
      this.bookings.set(bookings);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
