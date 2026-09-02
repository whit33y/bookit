import { Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import CalendarTile from './calendar-tile';
import EmployeesTile from './employees-tile';
import PendingTile from './pending-tile';
import ServicesTile from './services-tile';
import SettingsTile from './settings-tile';
import StatsTile from './stats-tile';

/**
 * Pulpit firmy (#132) — siatka kafelków, przez które wchodzi się na podstrony panelu.
 * Kalendarz i oczekujące rezerwacje (#133), statystyki (#134) oraz usługi, pracownicy
 * i ustawienia firmy (#135) mają własne podglądy. Każdy kafelek pobiera dane sam i trzyma
 * własne stany — błąd jednego nie gasi pozostałych.
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
  imports: [
    CalendarTile,
    PendingTile,
    StatsTile,
    ServicesTile,
    EmployeesTile,
    SettingsTile,
  ],
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
            <app-dashboard-services-tile />
          </li>
          <li>
            <app-dashboard-employees-tile />
          </li>
          <li>
            <app-dashboard-settings-tile />
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
