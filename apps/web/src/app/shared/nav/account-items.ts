import { Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore, homeFor, type UserRole } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';

/** Etykieta skrótu do strony domowej roli — musi opisywać cel z `homeFor`, więc klient
 *  dostaje „Strona główna", a nie „Moje wizyty" (#160). „Moje wizyty" zostają w pasku
 *  nawigacji dla wszystkich ról. */
const HOME_LABEL: Record<UserRole, TranslationKey> = {
  ADMIN: 'nav.admin',
  OWNER: 'nav.businessPanel',
  EMPLOYEE: 'nav.businessPanel',
  CLIENT: 'nav.home',
};

// wspólny kształt pozycji; różnią się tylko wagą, kolorem i pierścieniem fokusu
const ITEM_BASE =
  'block w-full rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2';
const HOME_CLASS = `${ITEM_BASE} font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-brand-600`;
const LOGOUT_CLASS = `${ITEM_BASE} font-semibold text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-600`;

/**
 * Sekcja konta w nawigacji (#125): adres zalogowanego, skrót do jego strony domowej
 * i wylogowanie — zamiast gołego przycisku „Wyloguj" w pasku.
 *
 * Sama treść, bez rozwijania: w pasku desktopowym opakowuje ją `user-menu.ts` w przycisk
 * z panelem, a poniżej `md` panel hamburgera wypisuje ją płasko (drugi poziom rozwijania
 * wewnątrz już rozwiniętego panelu byłby tylko utrudnieniem).
 *
 * Ikona zamiast inicjałów jest po stronie `user-menu.ts`: w tokenie (`AuthUser`) jest tylko
 * e-mail i rola — nie mamy imienia ani nazwiska, a inicjały z adresu udawałyby dane,
 * których nie ma.
 */
@Component({
  selector: 'app-account-items',
  imports: [RouterLink],
  host: {
    role: 'group',
    '[attr.aria-label]': "i18n.t('nav.account')",
  },
  template: `
    <p class="truncate px-3 py-2 text-[13px] font-semibold text-stone-400">
      {{ email() }}
    </p>
    @if (homeLink(); as link) {
      <a [routerLink]="link" (click)="selected.emit()" [class]="homeClass">{{
        homeLabel()
      }}</a>
    }
    <button type="button" (click)="onLogout()" [class]="logoutClass">
      {{ i18n.t('nav.logout') }}
    </button>
  `,
})
export default class AccountItems {
  protected readonly i18n = inject(I18nStore);
  private readonly auth = inject(AuthStore);

  /** Wybór pozycji — opakowanie z rozwijaniem zwija się po nim. */
  readonly selected = output<void>();

  protected readonly homeClass = HOME_CLASS;
  protected readonly logoutClass = LOGOUT_CLASS;

  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly homeLink = computed(() => {
    const role = this.auth.user()?.role;
    return role ? homeFor(role) : null;
  });
  protected readonly homeLabel = computed(() => {
    const role = this.auth.user()?.role;
    return role ? this.i18n.t(HOME_LABEL[role]) : '';
  });

  protected onLogout(): void {
    this.selected.emit();
    this.auth.logout();
  }
}
