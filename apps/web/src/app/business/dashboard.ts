import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../core/auth/auth-store';
import { I18nStore } from '../core/i18n/i18n-store';
import { PendingCountStore } from './pending-count-store';

// ponytail: placeholder — usługi/pracownicy/ustawienia to osobne issue
@Component({
  selector: 'app-business-dashboard',
  imports: [RouterLink],
  template: `
    <h1>{{ i18n.t('businessDashboard.title') }}</h1>
    <nav class="flex gap-4">
      <a routerLink="/business/calendar" class="text-brand-600 underline"
        >{{ i18n.t('businessDashboard.calendar') }}</a
      >
      <a routerLink="/business/pending" class="text-brand-600 underline"
        >{{ i18n.t('businessDashboard.pending') }}
        @if (pendingCount() > 0) {
          {{
            i18n.t('businessDashboard.pendingWithCount', {
              count: pendingCount(),
            })
          }}
        }
      </a>
      @if (isOwner()) {
        <a routerLink="/business/stats" class="text-brand-600 underline">{{
          i18n.t('businessDashboard.stats')
        }}</a>
      }
      <a routerLink="/business/services" class="text-brand-600 underline"
        >{{ i18n.t('businessDashboard.services') }}</a
      >
      <a routerLink="/business/employees" class="text-brand-600 underline"
        >{{ i18n.t('businessDashboard.employees') }}</a
      >
      <a routerLink="/business/settings" class="text-brand-600 underline"
        >{{ i18n.t('businessDashboard.settings') }}</a
      >
    </nav>
  `,
})
export default class BusinessDashboard {
  private readonly authStore = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  protected readonly pendingCount = inject(PendingCountStore).count;
  // trasa /business/stats jest za roleGuard('OWNER') — EMPLOYEE nie dostaje martwego linku
  protected readonly isOwner = computed(
    () => this.authStore.user()?.role === 'OWNER',
  );
}
