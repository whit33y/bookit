import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth-store';
import { I18nStore } from './core/i18n/i18n-store';
import { PendingCountStore } from './business/pending-count-store';
import LanguageSwitcher from './shared/i18n/language-switcher';
import NotificationBell from './shared/notifications/notification-bell';

@Component({
  imports: [RouterOutlet, RouterLink, NotificationBell, LanguageSwitcher],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);
  private readonly pendingCountStore = inject(PendingCountStore);

  protected readonly role = computed(() => this.auth.user()?.role);
  protected readonly pendingCount = this.pendingCountStore.count;

  constructor() {
    // licznik oczekujących w nawigacji (#33) — odświeżamy przy każdej zmianie roli
    // (login/logout/przełączenie konta), nie tylko raz przy starcie aplikacji
    effect(() => {
      this.role();
      void this.pendingCountStore.refresh();
    });
  }
}
