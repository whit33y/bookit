import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { todayInBusinessTz } from '../../shared/business-time';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import BarChart, { BarChartData } from '../../shared/ui/bar-chart';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';
import { isCalendarDate } from '../calendar/calendar-date';
import {
  STATUS_CLASSES,
  STATUS_LABELS,
} from '../calendar/booking-details-dialog';
import {
  STATS_PRESETS,
  StatsGranularity,
  StatsPreset,
  StatsRange,
  bucketLabel,
  formatMinutes,
  isStatsPreset,
  rangeForPreset,
  rangeLabel,
  shiftAnchor,
} from './stats-range';

// lustrzane typy backendu (BusinessStats z apps/api/.../stats/stats.service.ts, #56)
type BookingStatus = keyof typeof STATUS_LABELS;
type StatusCounts = Record<BookingStatus, number>;

interface SeriesBucket {
  bucket: string;
  total: number;
  byStatus: StatusCounts;
}

interface EmployeeOccupancy {
  employeeId: string;
  name: string;
  bookings: number;
  bookedMinutes: number;
  capacityMinutes: number;
  occupancyPercent: number | null;
}

interface TopService {
  serviceId: string;
  name: string;
  bookings: number;
  revenueCents: number;
}

interface BusinessStatsResponse {
  range: { from: string; to: string; granularity: StatsGranularity };
  totals: {
    bookings: number;
    byStatus: StatusCounts;
    completedBookings: number;
    completedRevenueCents: number;
    bookedMinutes: number;
    capacityMinutes: number;
    occupancyPercent: number | null;
  };
  series: SeriesBucket[];
  employees: EmployeeOccupancy[];
  topServices: TopService[];
}

/**
 * Kolejność i kolory serii wykresu. Kolejność od „najbardziej pozytywnej": zakończone na dole
 * stosu, odwołania na górze. Kolory jako wartości CSS, bo canvas nie zna klas Tailwinda —
 * odcienie te same, z których zbudowane są `STATUS_CLASSES` (kontrast AA sprawdzony tam).
 */
const STATUS_SERIES: { status: BookingStatus; color: string }[] = [
  { status: 'COMPLETED', color: '#c2410c' }, // brand-700
  { status: 'CONFIRMED', color: '#059669' }, // emerald-600
  { status: 'PENDING', color: '#d97706' }, // amber-600
  { status: 'DECLINED', color: '#e11d48' }, // rose-600
  { status: 'CANCELLED_BY_CLIENT', color: '#a8a29e' }, // stone-400
  { status: 'CANCELLED_BY_BUSINESS', color: '#fb7185' }, // rose-400
];

/**
 * Dashboard statystyk firmy (#56). Wszystkie agregaty liczy backend
 * (`GET /businesses/mine/stats`) — komponent wybiera zakres, formatuje i rysuje.
 *
 * Zakres żyje w adresie (`?preset=&from=&to=`), jak listy admina: odświeżenie strony i link
 * wysłany komuś z firmy pokazują ten sam okres.
 */
@Component({
  selector: 'app-business-stats',
  imports: [PricePlnPipe, BarChart, LoadingState, ErrorState, EmptyState],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Statystyki</h1>

      <div class="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Zakres statystyk"
          class="flex gap-1 rounded-lg border border-stone-200 p-1"
        >
          @for (option of presets; track option.value) {
            <button
              type="button"
              [attr.aria-pressed]="preset() === option.value"
              class="rounded-md px-3 py-1.5 text-sm font-semibold transition"
              [class]="
                preset() === option.value
                  ? 'bg-brand-700 text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              "
              (click)="setPreset(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>

        @if (preset() === 'custom') {
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label for="stats-from" class="mb-1.5 block text-sm font-medium">Od</label>
              <input
                id="stats-from"
                type="date"
                [value]="range().from"
                (change)="setCustomFrom($event)"
                class="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              />
            </div>
            <div>
              <label for="stats-to" class="mb-1.5 block text-sm font-medium">Do</label>
              <input
                id="stats-to"
                type="date"
                [value]="range().to"
                (change)="setCustomTo($event)"
                class="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
              />
            </div>
          </div>
        } @else {
          <div class="flex items-center gap-2">
            <button
              type="button"
              aria-label="Poprzedni okres"
              class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
              (click)="navigate(-1)"
            >
              ‹
            </button>
            <span class="min-w-[13rem] text-center text-sm font-semibold">{{
              periodLabel()
            }}</span>
            <button
              type="button"
              aria-label="Następny okres"
              class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
              (click)="navigate(1)"
            >
              ›
            </button>
            <button
              type="button"
              class="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-card transition hover:bg-stone-50"
              (click)="navigate('today')"
            >
              Dziś
            </button>
          </div>
        }
      </div>

      @if (rangeError(); as msg) {
        <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
      }

      @if (loading()) {
        <app-loading-state class="mt-8" message="Liczenie statystyk…" />
      } @else if (serverError(); as msg) {
        <app-error-state
          class="mt-8"
          [message]="msg"
          [retryable]="true"
          (retry)="onRetry()"
        />
      } @else if (stats(); as data) {
        <dl class="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <dt class="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Rezerwacje
            </dt>
            <dd class="mt-2 text-2xl font-bold tabular-nums">{{ data.totals.bookings }}</dd>
          </div>
          <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <dt class="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Zrealizowane wizyty
            </dt>
            <dd class="mt-2 text-2xl font-bold tabular-nums">
              {{ data.totals.completedBookings }}
            </dd>
          </div>
          <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <dt class="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Przychód z wizyt
            </dt>
            <dd class="mt-2 text-2xl font-bold tabular-nums">
              {{ data.totals.completedRevenueCents | pricePln }}
            </dd>
          </div>
          <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <dt class="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Średnie obłożenie
            </dt>
            <dd class="mt-2 text-2xl font-bold tabular-nums">
              @if (data.totals.occupancyPercent === null) {
                <span class="text-base font-semibold text-stone-400">brak grafiku</span>
              } @else {
                {{ data.totals.occupancyPercent }}%
              }
            </dd>
            <p class="mt-1 text-[13px] text-stone-500">
              {{ formatMinutes(data.totals.bookedMinutes) }} z
              {{ formatMinutes(data.totals.capacityMinutes) }}
            </p>
          </div>
        </dl>

        @if (data.totals.bookings) {
          <section class="mt-6 rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <h2 class="text-base font-bold">Rezerwacje wg statusu w czasie</h2>
            <p class="mt-1 text-sm text-stone-500">{{ granularityHint() }}</p>
            <app-bar-chart
              class="mt-4"
              [data]="chartData()"
              [caption]="'Rezerwacje wg statusu: ' + periodLabel()"
              [categoryHeader]="
                data.range.granularity === 'week' ? 'Tydzień od' : 'Dzień'
              "
            />
            <ul class="mt-4 flex flex-wrap gap-2">
              @for (row of statusTotals(); track row.status) {
                <li
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                  [class]="statusClasses[row.status]"
                >
                  {{ statusLabels[row.status] }}
                  <span class="tabular-nums">{{ row.count }}</span>
                </li>
              }
            </ul>
          </section>

          <section class="mt-6 rounded-xl border border-stone-200 bg-white p-6 shadow-card">
            <h2 class="text-base font-bold">Najpopularniejsze usługi</h2>
            <p class="mt-1 text-sm text-stone-500">
              Bez rezerwacji odwołanych i odrzuconych.
            </p>
            @if (data.topServices.length) {
              <div
                class="mt-4 overflow-x-auto"
                tabindex="0"
                role="region"
                aria-label="Tabela najpopularniejszych usług"
              >
                <table class="w-full min-w-[28rem] text-left text-sm">
                  <caption class="sr-only">
                    Najpopularniejsze usługi w okresie {{ periodLabel() }}
                  </caption>
                  <thead
                    class="border-b border-stone-200 text-[11px] font-semibold uppercase tracking-wider text-stone-500"
                  >
                    <tr>
                      <th scope="col" class="py-2 pr-4">Usługa</th>
                      <th scope="col" class="py-2 pr-4 text-right">Rezerwacje</th>
                      <th scope="col" class="py-2 text-right">Przychód</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-stone-100">
                    @for (service of data.topServices; track service.serviceId) {
                      <tr>
                        <td class="py-2.5 pr-4 font-semibold">{{ service.name }}</td>
                        <td class="py-2.5 pr-4 text-right tabular-nums">
                          {{ service.bookings }}
                        </td>
                        <td class="py-2.5 text-right tabular-nums">
                          {{ service.revenueCents | pricePln }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <app-empty-state class="mt-4" title="Brak usług do pokazania." />
            }
          </section>
        } @else {
          <app-empty-state
            class="mt-6"
            [boxed]="true"
            title="Brak rezerwacji w wybranym okresie."
            description="Zmień zakres dat, żeby zobaczyć wykres i najpopularniejsze usługi."
          />
        }

        <section class="mt-6 rounded-xl border border-stone-200 bg-white p-6 shadow-card">
          <h2 class="text-base font-bold">Obłożenie pracowników</h2>
          <p class="mt-1 text-sm text-stone-500">
            Zajęty czas w stosunku do grafiku pomniejszonego o urlopy.
          </p>
          @if (data.employees.length) {
            <ul aria-label="Obłożenie pracowników" class="mt-4 space-y-3">
              @for (row of occupancyRows(); track row.employeeId) {
                <li>
                  <!-- Wzorzec z rating-distribution.ts: wnętrze wiersza aria-hidden, całość
                       opisana jedną etykietą na role="img"; procent zawsze stoi jako tekst
                       obok paska (WCAG 1.4.1). -->
                  <span
                    role="img"
                    [attr.aria-label]="row.label"
                    class="flex flex-wrap items-center gap-3"
                  >
                    <span
                      aria-hidden="true"
                      class="w-40 shrink-0 truncate text-sm font-semibold"
                    >
                      {{ row.name }}
                    </span>
                    <span
                      aria-hidden="true"
                      class="h-2.5 min-w-32 flex-1 overflow-hidden rounded-full bg-stone-100"
                    >
                      <span
                        class="block h-full rounded-full bg-brand-700"
                        [style.width.%]="row.barPercent"
                      ></span>
                    </span>
                    <span
                      aria-hidden="true"
                      class="w-44 shrink-0 text-right text-[13px] font-medium tabular-nums text-stone-500"
                    >
                      {{ row.percentText }} · {{ row.minutesText }}
                    </span>
                  </span>
                </li>
              }
            </ul>
          } @else {
            <app-empty-state class="mt-4" title="Firma nie ma jeszcze pracowników." />
          }
        </section>
      }
    </div>
  `,
})
export default class BusinessStats {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly presets = STATS_PRESETS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly formatMinutes = formatMinutes;

  protected readonly preset = signal<StatsPreset>('month');
  protected readonly range = signal<StatsRange>(
    rangeForPreset('month', todayInBusinessTz()),
  );
  protected readonly stats = signal<BusinessStatsResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  /** Błąd samego zakresu (np. „do" przed „od") — nie chowa poprzednio wczytanych danych. */
  protected readonly rangeError = signal<string | null>(null);

  protected readonly periodLabel = computed(() =>
    rangeLabel(this.preset(), this.range()),
  );

  protected readonly granularityHint = computed(() =>
    this.stats()?.range.granularity === 'week'
      ? 'Kubełki tygodniowe — zakres dłuższy niż miesiąc.'
      : 'Kubełki dzienne.',
  );

  /** Serie tylko dla statusów, które w tym okresie wystąpiły — inaczej legenda to sam szum. */
  protected readonly chartData = computed<BarChartData>(() => {
    const data = this.stats();
    if (!data) {
      return { labels: [], series: [] };
    }
    return {
      labels: data.series.map((bucket) =>
        bucketLabel(bucket.bucket, data.range.granularity),
      ),
      series: STATUS_SERIES.filter(({ status }) => data.totals.byStatus[status] > 0).map(
        ({ status, color }) => ({
          label: STATUS_LABELS[status],
          color,
          data: data.series.map((bucket) => bucket.byStatus[status]),
        }),
      ),
    };
  });

  protected readonly statusTotals = computed(() => {
    const totals = this.stats()?.totals.byStatus;
    if (!totals) {
      return [];
    }
    return STATUS_SERIES.filter(({ status }) => totals[status] > 0).map(({ status }) => ({
      status,
      count: totals[status],
    }));
  });

  protected readonly occupancyRows = computed(() =>
    (this.stats()?.employees ?? []).map((row) => {
      const percentText =
        row.occupancyPercent === null ? 'brak grafiku' : `${row.occupancyPercent}%`;
      const minutesText = formatMinutes(row.bookedMinutes);
      return {
        ...row,
        // pasek przycięty do 100 %, liczba obok pokazuje prawdę — rezerwacja poza grafikiem
        // daje realne >100 % i nie chcemy tego chować
        barPercent: Math.min(row.occupancyPercent ?? 0, 100),
        percentText,
        minutesText,
        label:
          `${row.name}: obłożenie ${percentText}, ${minutesText} zajętego czasu ` +
          `z ${formatMinutes(row.capacityMinutes)} grafiku, ${row.bookings} rezerwacji`,
      };
    }),
  );

  // race-guard jak w calendar.ts — przeskakiwanie okresów wystrzeliwuje kolejne żądania,
  // a wolniejsza odpowiedź nie może nadpisać świeższej
  private requestId = 0;

  constructor() {
    this.readParamsFromUrl();
    void this.load();
  }

  protected setPreset(preset: StatsPreset): void {
    if (preset === this.preset()) {
      return;
    }
    this.preset.set(preset);
    this.rangeError.set(null);
    if (preset !== 'custom') {
      // kotwiczymy na początku dotychczasowego zakresu, żeby przełączenie tydzień↔miesiąc
      // zostało w okolicy oglądanego okresu, a nie skakało na „dziś"
      this.range.set(rangeForPreset(preset, this.range().from));
    }
    this.syncUrl();
    void this.load();
  }

  protected navigate(delta: -1 | 1 | 'today'): void {
    const preset = this.preset();
    if (preset === 'custom') {
      return;
    }
    const anchor =
      delta === 'today' ? todayInBusinessTz() : shiftAnchor(preset, this.range().from, delta);
    this.range.set(rangeForPreset(preset, anchor));
    this.syncUrl();
    void this.load();
  }

  protected setCustomFrom(event: Event): void {
    this.setCustomBound('from', event);
  }

  protected setCustomTo(event: Event): void {
    this.setCustomBound('to', event);
  }

  protected onRetry(): void {
    void this.load();
  }

  private setCustomBound(bound: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    // pusty albo niepełny input z natywnego date pickera — czekamy na kompletną datę
    if (!isCalendarDate(value)) {
      return;
    }
    const next = { ...this.range(), [bound]: value };
    if (next.to < next.from) {
      this.rangeError.set('Data „do" nie może być wcześniejsza niż „od".');
      return;
    }
    this.rangeError.set(null);
    this.range.set(next);
    this.syncUrl();
    void this.load();
  }

  /** Zakres z adresu; cokolwiek nie przejdzie walidacji, ustępuje domyślnemu miesiącowi. */
  private readParamsFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    const preset = params.get('preset');
    const from = params.get('from');
    const to = params.get('to');

    if (preset && isStatsPreset(preset)) {
      this.preset.set(preset);
    }
    if (from && to && isCalendarDate(from) && isCalendarDate(to) && from <= to) {
      this.range.set({ from, to });
      return;
    }
    const current = this.preset();
    if (current !== 'custom') {
      this.range.set(rangeForPreset(current, todayInBusinessTz()));
    }
  }

  private syncUrl(): void {
    const { from, to } = this.range();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { preset: this.preset(), from, to },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async load(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.serverError.set(null);
    try {
      const { from, to } = this.range();
      const data = await firstValueFrom(
        this.api.get<BusinessStatsResponse>(
          `/businesses/mine/stats?${new URLSearchParams({ from, to })}`,
        ),
      );
      if (id !== this.requestId) {
        return;
      }
      this.stats.set(data);
    } catch (err) {
      if (id !== this.requestId) {
        return;
      }
      this.serverError.set(apiErrorMessage(err));
    } finally {
      if (id === this.requestId) {
        this.loading.set(false);
      }
    }
  }
}
