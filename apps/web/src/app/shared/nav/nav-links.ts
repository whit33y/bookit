import { Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { UserRole } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import { ACTIVE_LINK, INACTIVE_LINK } from './nav-link-classes';

interface NavItem {
  path: string;
  label: string;
  /** Liczba oczekujących przy „Panelu firmy" (#33); zero i brak znaczą to samo — bez plakietki. */
  badge?: number;
}

/**
 * Linki nawigacji głównej zależne od roli (#125). Ta sama lista jest potrzebna w pasku
 * desktopowym i w panelu hamburgera, więc mieszka w jednym komponencie zamiast być kopiowana
 * w `app.html` — wejście `layout` zmienia wyłącznie klasy kontenera (w kolumnie linki i tak
 * rozciągają się na pełną szerokość jako elementy flexa).
 *
 * Same pozycje są danymi, a nie szablonem: przy pięciu wypisanych anchorach każda zmiana
 * pigułki czy atrybutu ARIA wymagałaby pięciu identycznych poprawek.
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
      @for (item of items(); track item.path) {
        <a
          [routerLink]="item.path"
          routerLinkActive=""
          #link="routerLinkActive"
          [class]="link.isActive ? activeLink : inactiveLink"
          [attr.aria-current]="link.isActive ? 'page' : null"
          >{{ item.label }}
          @if (item.badge) {
            <span
              class="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white"
              >{{ item.badge }}</span
            >
          }
        </a>
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

  protected readonly items = computed<NavItem[]>(() => {
    const role = this.userRole();
    if (!role) {
      return [
        { path: '/login', label: this.i18n.t('nav.login') },
        { path: '/register', label: this.i18n.t('nav.register') },
      ];
    }

    const items: NavItem[] = [
      { path: '/client', label: this.i18n.t('nav.myBookings') },
    ];
    if (role === 'OWNER' || role === 'EMPLOYEE') {
      items.push({
        path: '/business',
        label: this.i18n.t('nav.businessPanel'),
        badge: this.pendingCount(),
      });
    }
    if (role === 'ADMIN') {
      items.push({ path: '/admin', label: this.i18n.t('nav.admin') });
    }
    return items;
  });

  protected readonly containerClass = computed(() =>
    this.layout() === 'bar' ? 'flex items-center gap-1' : 'flex flex-col gap-0.5',
  );
}
