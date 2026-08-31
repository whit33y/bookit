import { Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import CalendarTile from './calendar-tile';
import DashboardTile from './dashboard-tile';
import PendingTile from './pending-tile';
import StatsTile from './stats-tile';

/**
 * Pulpit firmy (#132) — siatka kafelków, przez które wchodzi się na podstrony panelu.
 * Kalendarz, oczekujące rezerwacje (#133) i statystyki (#134) mają już własne podglądy,
 * reszta kafelków czeka na dane (#135 usługi/pracownicy/ustawienia). Każdy kafelek z podglądem

/**
 * Pulpit firmy (#132) — siatka kafelków, przez które wchodzi się na podstrony panelu.
 * Kalendarz i oczekujące rezerwacje mają już własne podglądy (#133), reszta kafelków czeka
 * na dane (#134 statystyki, #135 usługi/pracownicy/ustawienia). Każdy kafelek z podglądem
 * pobiera dane sam i trzyma własne stany — błąd jednego nie gasi pozostałych.
 *
 * Kafelki wypisane wprost, a nie generowane z listy danych: kolejność jest wymaganiem, a każdy
 * z podglądem jest osobnym komponentem z własnym pobieraniem — pętla nie miałaby po czym
 * iterować.
 *
 * Widoczność kafelków lustrzanie odbija `roleGuard('OWNER')` z `business.routes.ts`: EMPLOYEE
 * nie może dostać linku, który skończy się odbiciem od strażnika trasy.
 */
@Component({
  selector: 'app-business-dashboard',
  imports: [DashboardTile, CalendarTile, PendingTile, StatsTile],
  imports: [DashboardTile, CalendarTile, PendingTile],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        {{ i18n.t('businessDashboard.title') }}
      </h1>

      <ul class="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <app-dashboard-calendar-tile />
        </li>
        <li>
          <app-dashboard-pending-tile />
        </li>
        @if (isOwner()) {
          <li>
            <app-dashboard-stats-tile />
          </li>
          <li>
            <app-dashboard-tile
              [heading]="i18n.t('businessDashboard.services')"
              link="/business/services"
            />
          </li>
          <li>
            <app-dashboard-tile
              [heading]="i18n.t('businessDashboard.employees')"
              link="/business/employees"
            />
          </li>
          <li>
            <app-dashboard-tile
              [heading]="i18n.t('businessDashboard.settings')"
              link="/business/settings"
            />
          </li>
        }
      </ul>
    </div>
  `,
})
export default class BusinessDashboard {
  private readonly authStore = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  protected readonly isOwner = computed(
    () => this.authStore.user()?.role === 'OWNER',
  );
}
