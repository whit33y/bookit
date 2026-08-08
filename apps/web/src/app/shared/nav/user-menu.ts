import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore, homeFor, type UserRole } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';

/** Etykieta skrótu do strony domowej roli — te same klucze co linki w pasku, bez nowych tłumaczeń. */
const HOME_LABEL: Record<UserRole, TranslationKey> = {
  ADMIN: 'nav.admin',
  OWNER: 'nav.businessPanel',
  EMPLOYEE: 'nav.businessPanel',
  CLIENT: 'nav.myBookings',
};

const ITEM_CLASS =
  'block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * Sekcja konta w nawigacji (#125): adres zalogowanego, skrót do jego strony domowej
 * i wylogowanie — zamiast gołego przycisku „Wyloguj" w pasku.
 *
 * Dwie prezentacje tej samej treści, bo poniżej `md` całość chowa się w panelu hamburgera:
 * `layout="menu"` to przycisk z ikoną i rozwijany panel (pasek desktopowy), `layout="panel"`
 * wypisuje te same pozycje płasko (panel mobilny ma już własny przycisk rozwijający i drugi
 * poziom rozwijania byłby tylko utrudnieniem).
 *
 * Wzorzec „disclosure" jak w `shared/notifications/notification-bell.ts`, nie `role="menu"`:
 * to skrót nawigacyjny plus jedna komenda, a nie menu wymagające obsługi strzałkami. Panel stoi
 * w DOM zaraz za przyciskiem, więc Tab wchodzi w niego bez przestawiania fokusu; Escape zamyka
 * i oddaje fokus przyciskowi, bo inaczej zniknąłby razem z panelem.
 *
 * Ikona zamiast inicjałów: w tokenie (`AuthUser`) jest tylko e-mail i rola — nie mamy imienia
 * ani nazwiska, a inicjały z adresu udawałyby dane, których nie ma.
 */
@Component({
  selector: 'app-user-menu',
  imports: [NgTemplateOutlet, RouterLink],
  host: {
    class: 'relative',
    '[class.inline-block]': "layout() === 'menu'",
    '[class.block]': "layout() === 'panel'",
    '(keydown.escape)': 'closeAndRefocus()',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    @if (layout() === 'menu') {
      <button
        #trigger
        type="button"
        [attr.aria-expanded]="open()"
        aria-controls="user-menu-panel"
        aria-haspopup="true"
        [attr.aria-label]="i18n.t('nav.userMenu')"
        (click)="toggle()"
        class="grid h-9 w-9 place-items-center rounded-full transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <span
          aria-hidden="true"
          class="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </span>
      </button>

      @if (open()) {
        <div
          id="user-menu-panel"
          role="group"
          [attr.aria-label]="i18n.t('nav.account')"
          class="absolute right-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white p-1.5 shadow-raised"
        >
          <ng-container [ngTemplateOutlet]="items" />
        </div>
      }
    } @else {
      <div role="group" [attr.aria-label]="i18n.t('nav.account')">
        <ng-container [ngTemplateOutlet]="items" />
      </div>
    }

    <ng-template #items>
      <p class="truncate px-3 py-2 text-[13px] font-semibold text-stone-400">
        {{ email() }}
      </p>
      @if (homeLink(); as link) {
        <a [routerLink]="link" (click)="close()" [class]="itemClass">{{ homeLabel() }}</a>
      }
      <button
        type="button"
        (click)="onLogout()"
        class="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
      >
        {{ i18n.t('nav.logout') }}
      </button>
    </ng-template>
  `,
})
export default class UserMenu {
  protected readonly i18n = inject(I18nStore);
  private readonly auth = inject(AuthStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /** `menu` — przycisk z rozwijanym panelem (pasek); `panel` — płaska lista (hamburger). */
  readonly layout = input<'menu' | 'panel'>('menu');

  protected readonly open = signal(false);
  protected readonly itemClass = ITEM_CLASS;

  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly homeLink = computed(() => {
    const role = this.auth.user()?.role;
    return role ? homeFor(role) : null;
  });
  protected readonly homeLabel = computed(() => {
    const role = this.auth.user()?.role;
    return role ? this.i18n.t(HOME_LABEL[role]) : '';
  });

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onLogout(): void {
    this.open.set(false);
    this.auth.logout();
  }

  /** Klik poza menu zamyka panel — bez oddawania fokusu, bo użytkownik jest już indziej. */
  protected onDocumentClick(event: Event): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  protected closeAndRefocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
