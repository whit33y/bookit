import { Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { UserRole } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import { ACTIVE_LINK, INACTIVE_LINK } from './nav-link-classes';

/**
 * Linki nawigacji głównej zależne od roli (#125). Ta sama lista jest potrzebna w pasku
 * desktopowym i w panelu hamburgera, więc mieszka w jednym komponencie zamiast być kopiowana
 * w `app.html` — wejście `layout` zmienia wyłącznie klasy kontenera (w kolumnie linki i tak
 * rozciągają się na pełną szerokość jako elementy flexa).
 *
 * Komponent jest celowo prezentacyjny (rola i licznik jako wejścia, poza tłumaczeniami zero
 * wstrzykniętych store'ów): renderujemy go dwa razy naraz, a store z licznikiem oczekujących
 * odpytuje API — drugi egzemplarz zdublowałby żądania.
 */
@Component({
  selector: 'app-nav-links',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div [class]="containerClass()">
      @if (userRole()) {
        <a
          routerLink="/client"
          routerLinkActive=""
          #clientLink="routerLinkActive"
          [class]="clientLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="clientLink.isActive ? 'page' : null"
          class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >{{ i18n.t('nav.myBookings') }}</a
        >
        @if (userRole() === 'OWNER' || userRole() === 'EMPLOYEE') {
          <a
            routerLink="/business"
            routerLinkActive=""
            #businessLink="routerLinkActive"
            [class]="businessLink.isActive ? activeLink : inactiveLink"
            [attr.aria-current]="businessLink.isActive ? 'page' : null"
            class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >{{ i18n.t('nav.businessPanel') }}
            @if (pendingCount() > 0) {
              <span
                class="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white"
                >{{ pendingCount() }}</span
              >
            }
          </a>
        }
        @if (userRole() === 'ADMIN') {
          <a
            routerLink="/admin"
            routerLinkActive=""
            #adminLink="routerLinkActive"
            [class]="adminLink.isActive ? activeLink : inactiveLink"
            [attr.aria-current]="adminLink.isActive ? 'page' : null"
            class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >{{ i18n.t('nav.admin') }}</a
          >
        }
      } @else {
        <a
          routerLink="/login"
          routerLinkActive=""
          #loginLink="routerLinkActive"
          [class]="loginLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="loginLink.isActive ? 'page' : null"
          class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >{{ i18n.t('nav.login') }}</a
        >
        <a
          routerLink="/register"
          routerLinkActive=""
          #registerLink="routerLinkActive"
          [class]="registerLink.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="registerLink.isActive ? 'page' : null"
          class="rounded-lg px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >{{ i18n.t('nav.register') }}</a
        >
      }
    </div>
  `,
})
export default class NavLinks {
  protected readonly i18n = inject(I18nStore);

  /** Rola zalogowanego; `undefined` = gość (wtedy Zaloguj/Rejestracja). */
  readonly userRole = input<UserRole | undefined>(undefined);
  readonly pendingCount = input(0);
  /** `bar` — pasek desktopowy; `panel` — rozwinięty hamburger. */
  readonly layout = input<'bar' | 'panel'>('bar');

  protected readonly activeLink = ACTIVE_LINK;
  protected readonly inactiveLink = INACTIVE_LINK;

  protected readonly containerClass = computed(() =>
    this.layout() === 'bar' ? 'flex items-center gap-1' : 'flex flex-col gap-0.5',
  );
}
