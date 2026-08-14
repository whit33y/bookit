import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  NavigationSkipped,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from './core/auth/auth-store';
import { I18nStore } from './core/i18n/i18n-store';
import { PendingCountStore } from './business/pending-count-store';
import LanguageSwitcher from './shared/i18n/language-switcher';
import AccountItems from './shared/nav/account-items';
import NavLinks from './shared/nav/nav-links';
import UserMenu from './shared/nav/user-menu';
import NotificationBell from './shared/notifications/notification-bell';

/** Breakpoint `md` Tailwinda — powyżej niego panel hamburgera jest schowany przez CSS. */
const MD_BREAKPOINT = 768;

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    NavLinks,
    NotificationBell,
    LanguageSwitcher,
    UserMenu,
    AccountItems,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    // na dokumencie, nie na hoście: po kliknięciu w niefokusowalny fragment panelu
    // `document.activeElement` wraca na `<body>`, a stamtąd zdarzenie nie przechodzi
    // przez `app-root`. Wierzchnie panele (dzwoneczek, menu konta) zatrzymują propagację,
    // więc jedno naciśnięcie zamyka tylko jedną warstwę.
    '(document:keydown.escape)': 'closeMenuAndRefocus()',
    '(window:resize)': 'closeMenuOnDesktop()',
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
    // taki listener nigdy nie zobaczyłby kliku „poza", a zjadłby klik w sam hamburger —
    // klik poza panelem łapie przezroczysta kurtyna w szablonie.
    // `NavigationSkipped` obok `NavigationEnd`: link do trasy, na której już jesteśmy,
    // nie kończy się nawigacją (domyślne `onSameUrlNavigation: 'ignore'`), a panel i tak
    // ma się zwinąć — inaczej tapnięcie w bieżącą pozycję nie robiłoby nic widocznego.
    this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd || event instanceof NavigationSkipped,
        ),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Escape zamyka panel i oddaje fokus hamburgerowi — inaczej zniknąłby razem z panelem. */
  protected closeMenuAndRefocus(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.menuTrigger()?.nativeElement.focus();
  }

  /** Powyżej `md` panel i hamburger znikają przez CSS, ale sygnał zostałby na `true`:
   *  hamburger raportowałby `aria-expanded="true"`, a po powrocie do wąskiego okna panel
   *  rozwinąłby się sam nad treścią. */
  protected closeMenuOnDesktop(): void {
    if (this.menuOpen() && window.innerWidth >= MD_BREAKPOINT) {
      this.menuOpen.set(false);
    }
  }
}
