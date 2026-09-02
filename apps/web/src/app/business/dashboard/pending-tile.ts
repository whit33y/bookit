import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { formatDate, formatTime } from '../../shared/business-time';
import { CalendarBooking } from '../calendar/booking-details-dialog';
import { byStartsAt, mineBookingsUrl } from '../mine-bookings';
import { pendingRange } from '../pending-count-store';
import CountPreview, { type PreviewItem } from './count-preview';
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
 *
 * Układ „liczba + próbka" dzieli z kafelkami usług i pracowników (#135) — `CountPreview`.
 */
@Component({
  selector: 'app-dashboard-pending-tile',
  imports: [DashboardTile, CountPreview],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.pending')"
      link="/business/pending"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      [noticeTitle]="i18n.t('businessDashboard.pendingEmpty')"
      [noticeCta]="i18n.t('businessDashboard.pendingCta')"
      (retry)="onRetry()"
    >
      <app-dashboard-count-preview
        [headline]="i18n.plural('businessDashboard.pendingWithCount', count())"
        [items]="preview()"
      />
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

  /** Formatowanie siedzi w `computed()`, nie w szablonie — jak w kafelku kalendarza; dzięki
   *  temu próbka przelicza się też po zmianie języka (czyta `Intl`, #57). */
  protected readonly preview = computed<PreviewItem[]>(() =>
    this.pending()
      .slice(0, PENDING_PREVIEW_LIMIT)
      .map((booking) => ({
        id: booking.id,
        primary: `${booking.client.firstName} ${booking.client.lastName}`,
        secondary: `${booking.service.name} · ${formatDate(booking.startsAt)}, ${formatTime(booking.startsAt)}`,
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
