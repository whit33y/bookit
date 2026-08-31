import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import { todayInBusinessTz } from '../../shared/business-time';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import { statsPath } from '../stats/stats-params';
import { rangeForPreset } from '../stats/stats-range';
import type {
  BusinessStatsResponse,
  StatsTotals,
} from '../stats/stats-response';
import DashboardTile, { type TileState } from './dashboard-tile';

/**
 * Kafelek statystyk na pulpicie firmy (#134): trzy liczby za bieżący miesiąc — rezerwacje,
 * przychód zrealizowany i obłożenie. Bez wykresu i bez wyboru zakresu; jedno i drugie stoi
 * na `/business/stats`, dokąd kafelek prowadzi.
 *
 * Okres to dokładnie `rangeForPreset('month', …)` — ten sam zakres, który `/business/stats`
 * pokazuje domyślnie (`readStatsParams` bez parametrów w adresie wraca do presetu „month").
 * Dlatego link jest goły, bez querystringu: liczby po kliknięciu są tymi samymi liczbami,
 * tylko w większym stopniu szczegółowości. Arytmetyka dat zostaje w `stats-range.ts` — drugiej
 * definicji „bieżącego miesiąca" w tym panelu być nie może.
 *
 * Kafelek jest tylko dla OWNER-a i nie sprawdza tego sam: renderuje go `dashboard.ts` pod tym
 * samym warunkiem, którym `business.routes.ts` chroni trasę (`roleGuard('OWNER')`). Endpoint
 * `GET /businesses/mine/stats` też jest `@Roles(OWNER)`, więc EMPLOYEE nie dostaje ani linku,
 * ani żądania, które i tak wróciłoby 403.
 */
@Component({
  selector: 'app-dashboard-stats-tile',
  imports: [DashboardTile, PricePlnPipe],
  host: { class: 'block h-full' },
  template: `
    <app-dashboard-tile
      [heading]="i18n.t('businessDashboard.stats')"
      link="/business/stats"
      [state]="state()"
      [errorMessage]="serverError() ?? ''"
      (retry)="onRetry()"
    >
      @if (totals(); as data) {
        <p class="text-stone-500">
          {{ i18n.t('businessDashboard.statsPeriod') }}
        </p>

        <dl class="mt-3 grid grid-cols-3 gap-3">
          <div class="min-w-0">
            <dt
              class="truncate text-[11px] font-semibold uppercase tracking-wider text-stone-400"
            >
              {{ i18n.t('businessDashboard.statsBookings') }}
            </dt>
            <dd class="mt-1 text-lg font-bold tabular-nums">
              {{ data.bookings }}
            </dd>
          </div>

          <div class="min-w-0">
            <dt
              class="truncate text-[11px] font-semibold uppercase tracking-wider text-stone-400"
            >
              {{ i18n.t('businessDashboard.statsRevenue') }}
            </dt>
            <dd class="mt-1 text-lg font-bold tabular-nums">
              {{ data.completedRevenueCents | pricePln }}
            </dd>
          </div>

          <div class="min-w-0">
            <dt
              class="truncate text-[11px] font-semibold uppercase tracking-wider text-stone-400"
            >
              {{ i18n.t('businessDashboard.statsOccupancy') }}
            </dt>
            <dd class="mt-1 text-lg font-bold tabular-nums">
              @if (data.occupancyPercent === null) {
                <!-- „—", nie „0%": brak grafiku to brak mianownika, a nie puste obłożenie.
                     Sam myślnik nic nie mówi czytnikowi ekranu, więc powód idzie obok. -->
                <span aria-hidden="true" class="text-stone-400">—</span>
                <span class="sr-only">{{
                  i18n.t('stats.total.noSchedule')
                }}</span>
              } @else {
                {{ data.occupancyPercent }}%
              }
            </dd>
          </div>
        </dl>
      }
    </app-dashboard-tile>
  `,
})
export default class StatsTile {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly totals = signal<StatsTotals | null>(null);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);

  // stanu pustego nie ma: miesiąc bez rezerwacji to trzy zera i to jest odpowiedź na pytanie
  // „jak idzie", a nie brak danych
  protected readonly state = computed<TileState>(() => {
    if (this.loading()) return 'loading';
    if (this.serverError()) return 'error';
    return 'content';
  });

  constructor() {
    void this.load();
  }

  protected onRetry(): void {
    void this.load();
  }

  // bez strażnika wyścigu, którego mają `stats.ts` i `pending-count-store.ts`: tam kolejne
  // żądania wystrzeliwuje przeskakiwanie okresów, tu jedynym wyzwalaczem jest ponowienie po
  // błędzie, a przycisk ponowienia znika na czas ładowania — dwa `load()` nie zachodzą na siebie
  private async load(): Promise<void> {
    this.loading.set(true);
    this.serverError.set(null);
    // zakres liczony przy każdym pobraniu, nie raz na komponent — po północy ponowienie ma
    // dotyczyć bieżącego miesiąca, a nie tego, który trwał w chwili otwarcia pulpitu
    const range = rangeForPreset('month', todayInBusinessTz());
    try {
      const data = await firstValueFrom(
        this.api.get<BusinessStatsResponse>(statsPath(range)),
      );
      this.totals.set(data.totals);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
