import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from './core/auth/auth-store';
import { I18nStore } from './core/i18n/i18n-store';
import { PendingCountStore } from './business/pending-count-store';
import LanguageSwitcher from './shared/i18n/language-switcher';
import NavLinks from './shared/nav/nav-links';
import UserMenu from './shared/nav/user-menu';
import NotificationBell from './shared/notifications/notification-bell';

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    NavLinks,
    NotificationBell,
    LanguageSwitcher,
    UserMenu,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(keydown.escape)': 'closeMenuAndRefocus()',
  },
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);
  private readonly pendingCountStore = inject(PendingCountStore);
  private readonly router = inject(Router);
  private readonly menuTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');

  protected readonly role = computed(() => this.auth.user()?.role);
  protected readonly pendingCount = this.pendingCountStore.count;

  /** Panel hamburgera (#125) — poniżej `md` mieszka w nim wszystko poza dzwoneczkiem. */
  protected readonly menuOpen = signal(false);

  constructor() {
    // licznik oczekujących w nawigacji (#33) — odświeżamy przy każdej zmianie roli
    // (login/logout/przełączenie konta), nie tylko raz przy starcie aplikacji
    effect(() => {
      this.role();
      void this.pendingCountStore.refresh();
    });

    // Zamknięcie po nawigacji — obsługuje też klik w link wewnątrz panelu. Nie ma tu
    // odpowiednika `(document:click)` z dzwoneczka: hostem `App` jest cała aplikacja, więc
    // taki listener nigdy nie zobaczyłby kliku „poza", a zjadłby klik w sam hamburger.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Escape zamyka panel i oddaje fokus hamburgerowi — inaczej zniknąłby razem z panelem. */
  protected closeMenuAndRefocus(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.menuTrigger()?.nativeElement.focus();
  }
}
