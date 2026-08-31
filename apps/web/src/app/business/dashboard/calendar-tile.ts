import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import { formatTime, todayInBusinessTz } from '../../shared/business-time';
import {
  CalendarBooking,
  STATUS_KEYS,
} from '../calendar/booking-details-dialog';
import { formatDayLabel } from '../calendar/calendar-date';
import { mineBookingsUrl } from '../mine-bookings';
import {
  AgendaStatus,
  agendaRange,
  todayVisitCount,
  upcomingAgenda,
} from './agenda';
import DashboardTile, { type TileState } from './dashboard-tile';

/**
 * Kropka statusu w agendzie. Odcienie z `STATUS_CLASSES` (booking-details-dialog.ts), ale
 * z pary bierzemy ten od tekstu (700), nie tło (50): kropka wielkości 8 px w kolorze tła
 * byłaby na jasnym tle kafelka niewidoczna.
 *
 * Mapa jest wypisana wprost, a nie wyliczana z `STATUS_CLASSES`: Tailwind generuje klasy,
 * które znajdzie w źródle jako literały, więc `'bg-' + odcień` zostałoby bez CSS. Zgodność
 * z paletą pilnuje test w calendar-tile.spec.ts.
 */
const AGENDA_DOT_CLASSES: Record<AgendaStatus, string> = {
  CONFIRMED: 'bg-emerald-700',
  PENDING: 'bg-amber-700',
};

/** Jedna pozycja agendy, gotowa do wyświetlenia. Budowana w `computed()`, żeby szablon nie
 *  wywoływał funkcji formatujących — i żeby cała agenda przeliczyła się po zmianie języka
 *  (czyta `translate`/`Intl`, oba reaktywne na sygnał locale, #57). */
interface AgendaItem {
  id: string;
  time: string;
  /** `null` dla dzisiejszych wizyt — etykieta dnia ma odróżniać te spoza dzisiaj. */
  dayLabel: string | null;
  dotClass: string;
  /** Sama kropka to kolor, a kolor nie niesie treści dla czytnika ekranu (WCAG 1.4.1). */
  statusLabel: string;
  summary: string;
}

/**
 * Kafelek kalendarza na pulpicie firmy (#133) — agenda najbliższych wizyt, nie miniatura
 * siatki miesiąca. Nagłówek niesie kontekst dnia („Dziś: 3 wizyty"), lista pod nim mówi,
 * co dalej — także z jutra, gdy dziś nic już nie zostało.
 *
 * Kafelek pobiera dane sam, własnym żądaniem i z własnymi stanami: błąd kalendarza nie może
 * zabrać z pulpitu oczekujących rezerwacji ani odwrotnie.
 *
 * Pozycje listy nie są klikalne — kafelek jest jednym linkiem na `/business/calendar`
 * (patrz `DashboardTile`), a wybór konkretnej wizyty należy do kalendarza.
 */
@Component({
  selector: 'app-dashboard-calendar-tile',
  imports: [DashboardTile],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.calendar')"
      link="/business/calendar"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      [emptyTitle]="i18n.t('businessDashboard.calendarEmpty')"
      [emptyCta]="i18n.t('businessDashboard.calendarCta')"
      (retry)="onRetry()"
    >
      <p class="font-semibold">{{ headline() }}</p>

      @if (agenda().length) {
        <ul class="mt-3 flex flex-col gap-2">
          @for (item of agenda(); track item.id) {
            <li class="flex gap-2">
              <span
                aria-hidden="true"
                class="mt-1.5 size-2 shrink-0 rounded-full"
                [class]="item.dotClass"
              ></span>
              <span class="sr-only">{{ item.statusLabel }}</span>
              <span class="min-w-0">
                <span class="font-semibold tabular-nums">{{ item.time }}</span>
                @if (item.dayLabel) {
                  <span class="ml-1 text-stone-500">{{ item.dayLabel }}</span>
                }
                <span class="block truncate text-stone-600">{{
                  item.summary
                }}</span>
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="mt-3 text-stone-500">
          {{ i18n.t('businessDashboard.calendarNoUpcoming') }}
        </p>
      }
    </app-dashboard-tile>
  `,
})
export default class CalendarTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly bookings = signal<CalendarBooking[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  /** „Teraz" zamrożone na moment pobrania — jeden znacznik dla zakresu zapytania, odcięcia
   *  agendy i przypisania wizyt do dzisiejszego dnia. Gdyby każde z nich czytało zegar
   *  osobno, kafelek mógłby pokazać wizytę spoza zakresu, który sam zamówił. */
  protected readonly now = signal(Date.now());

  protected readonly todayCount = computed(() =>
    todayVisitCount(this.bookings(), this.now()),
  );

  protected readonly agenda = computed<AgendaItem[]>(() => {
    const now = this.now();
    const today = todayInBusinessTz(new Date(now));
    return upcomingAgenda(this.bookings(), now).map((booking) => {
      const day = todayInBusinessTz(new Date(booking.startsAt));
      return {
        id: booking.id,
        time: formatTime(booking.startsAt),
        dayLabel: day === today ? null : formatDayLabel(day),
        dotClass: AGENDA_DOT_CLASSES[booking.status],
        statusLabel: translate(STATUS_KEYS[booking.status]),
        summary: `${booking.service.name} · ${booking.client.firstName} ${booking.client.lastName}`,
      };
    });
  });

  protected readonly headline = computed(() =>
    this.todayCount() === 0
      ? this.i18n.t('businessDashboard.todayNone')
      : this.i18n.plural('businessDashboard.todayCount', this.todayCount()),
  );

  // pustka to brak wizyt dziś ORAZ dalej — samo „Dziś: 0 wizyt" byłoby liczbą tam, gdzie
  // AC #133 chce stanu pustego, a nagłówek „Dziś brak wizyt" ma sens tylko wtedy, gdy lista
  // pokazuje jeszcze coś z kolejnych dni
  protected readonly state = computed<TileState>(() => {
    if (this.loading()) return 'loading';
    if (this.serverError()) return 'error';
    return this.todayCount() || this.agenda().length ? 'content' : 'empty';
  });

  constructor() {
    void this.load();
  }

  protected onRetry(): void {
    void this.load();
  }

  // bez strażnika wyścigu (jak w calendar.ts): drugie pobranie da się wywołać tylko
  // przyciskiem ponowienia, a ten istnieje wyłącznie w stanie błędu — pierwszy klik przełącza
  // kafelek na „ładowanie" i zabiera przycisk, więc dwa żądania nigdy nie lecą równolegle
  private async load(): Promise<void> {
    this.loading.set(true);
    this.serverError.set(null);
    this.now.set(Date.now());
    try {
      const bookings = await firstValueFrom(
        this.api.get<CalendarBooking[]>(
          mineBookingsUrl(agendaRange(this.now())),
        ),
      );
      this.bookings.set(bookings);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
