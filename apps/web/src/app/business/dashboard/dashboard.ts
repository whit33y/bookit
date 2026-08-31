import { Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import DashboardTile from './dashboard-tile';

/**
 * Pulpit firmy (#132) — siatka kafelków, przez które wchodzi się na podstrony panelu.
 * Kafelki są tu jeszcze puste: skorupa, kolejność i filtr roli. Podglądy danych dokładają
 * kolejne issues (#133 kalendarz i oczekujące, #134 statystyki, #135 usługi/pracownicy/ustawienia),
 * każdy kafelek własnym żądaniem i własnymi stanami.
 *
 * Kafelki wypisane wprost, a nie generowane z listy danych: kolejność jest wymaganiem, a każdy
 * z nich zamieni się wkrótce w osobny komponent z własnym pobieraniem — wtedy pętla i tak
 * musiałaby zniknąć.
 *
 * Widoczność kafelków lustrzanie odbija `roleGuard('OWNER')` z `business.routes.ts`: EMPLOYEE
 * nie może dostać linku, który skończy się odbiciem od strażnika trasy.
 */
@Component({
  selector: 'app-business-dashboard',
  imports: [DashboardTile],
  template: `
    <div class="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        {{ i18n.t('businessDashboard.title') }}
      </h1>

      <ul class="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <app-dashboard-tile
            [heading]="i18n.t('businessDashboard.calendar')"
            link="/business/calendar"
          />
        </li>
        <li>
          <app-dashboard-tile
            [heading]="i18n.t('businessDashboard.pending')"
            link="/business/pending"
          />
        </li>
        @if (isOwner()) {
          <li>
            <app-dashboard-tile
              [heading]="i18n.t('businessDashboard.stats')"
              link="/business/stats"
            />
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
