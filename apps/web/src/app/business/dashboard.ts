import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PendingCountStore } from './pending-count-store';

// ponytail: placeholder — usługi/pracownicy/ustawienia to osobne issue
@Component({
  selector: 'app-business-dashboard',
  imports: [RouterLink],
  template: `
    <h1>Panel firmy</h1>
    <nav class="flex gap-4">
      <a routerLink="/business/calendar" class="text-brand-600 underline"
        >Kalendarz</a
      >
      <a routerLink="/business/pending" class="text-brand-600 underline"
        >Oczekujące rezerwacje
        @if (pendingCount() > 0) {
          ({{ pendingCount() }})
        }
      </a>
      <a routerLink="/business/services" class="text-brand-600 underline"
        >Usługi</a
      >
      <a routerLink="/business/employees" class="text-brand-600 underline"
        >Pracownicy</a
      >
      <a routerLink="/business/settings" class="text-brand-600 underline"
        >Ustawienia firmy</a
      >
    </nav>
  `,
})
export default class BusinessDashboard {
  protected readonly pendingCount = inject(PendingCountStore).count;
}
