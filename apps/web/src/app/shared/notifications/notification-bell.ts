import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate, translatePlural } from '../../core/i18n/translate';
import { formatRelativeTime } from '../business-time';
import EmptyState from '../ui/empty-state';
import ErrorState from '../ui/error-state';
import LoadingState from '../ui/loading-state';
import { AppNotification, NotificationsStore } from './notifications-store';

/** Powyżej dziewiątki plakietka rośnie zamiast informować — dokładna liczba jest w panelu. */
const BADGE_MAX = 9;

/**
 * Dzwoneczek powiadomień w nawigacji (#54): plakietka z liczbą nieprzeczytanych plus panel
 * z listą; klik w wiersz oznacza jako przeczytane i prowadzi do wizyty.
 *
 * Wzorzec „disclosure", nie `role="menu"`: to lista linków do ekranów, a nie menu komend, więc
 * nie ma tu być nawigacji strzałkami ani przechwytywania Tab. Panel stoi w DOM zaraz za
 * przyciskiem, dzięki czemu Tab wchodzi w listę bez ręcznego przestawiania fokusu; Escape
 * zamyka i oddaje fokus przyciskowi, bo inaczej zniknąłby razem z panelem.
 *
 * Nie `<dialog>` (jak confirm-dialog.ts): tamten wzorzec jest modalny — przygasza tło i blokuje
 * resztę strony, a powiadomienia mają być podglądem w biegu.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [LoadingState, ErrorState, EmptyState],
  host: {
    class: 'relative inline-block',
    '(keydown.escape)': 'closeAndRefocus()',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      [attr.aria-expanded]="open()"
      aria-controls="notifications-panel"
      aria-haspopup="true"
      [attr.aria-label]="triggerLabel()"
      (click)="toggle()"
      class="relative grid h-9 w-9 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <svg
        aria-hidden="true"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M15 17h5l-1.4-1.7A2 2 0 0118 14V11a6 6 0 10-12 0v3a2 2 0 01-.6 1.3L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      @if (unread() > 0) {
        <!-- liczba jest już w aria-label przycisku, więc plakietka jest tylko wizualna -->
        <span
          aria-hidden="true"
          class="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
          >{{ badgeText() }}</span
        >
      }
    </button>

    @if (open()) {
      <div
        id="notifications-panel"
        role="group"
        [attr.aria-label]="i18n.t('notifications.title')"
        class="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white shadow-raised"
      >
        <div class="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 class="text-sm font-bold">{{ i18n.t('notifications.title') }}</h2>
          @if (unread() > 0) {
            <button
              type="button"
              (click)="onMarkAll()"
              class="rounded-md px-2 py-1 text-[13px] font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              {{ i18n.t('notifications.markAll') }}
            </button>
          }
        </div>

        @if (loading()) {
          <app-loading-state
            [message]="i18n.t('notifications.loading')"
            paddingClass="p-6"
          />
        } @else if (error(); as msg) {
          <app-error-state
            class="p-4"
            [message]="msg"
            [retryable]="true"
            (retry)="onRetry()"
          />
        } @else if (items().length) {
          <ul class="max-h-96 divide-y divide-stone-100 overflow-y-auto">
            @for (n of items(); track n.id) {
              <li>
                <!-- prawdziwy <a href>: środkowy klik i „otwórz w nowej karcie" mają działać,
                     a lewy klik przechwytujemy, żeby nawigacja została w SPA -->
                <a
                  [href]="n.url"
                  (click)="onSelect($event, n)"
                  class="flex gap-2.5 px-4 py-3 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
                  [class]="n.readAt === null ? 'bg-brand-50/60' : ''"
                >
                  <span
                    aria-hidden="true"
                    class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    [class]="n.readAt === null ? 'bg-brand-600' : 'bg-transparent'"
                  ></span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[13px] font-bold text-stone-800">
                      {{ n.title }}
                      @if (n.readAt === null) {
                        <!-- kolor nie może być jedynym nośnikiem informacji (WCAG 1.4.1) -->
                        <span class="sr-only">{{
                          i18n.t('notifications.unreadMarker')
                        }}</span>
                      }
                    </span>
                    <span class="mt-0.5 block text-[13px] leading-snug text-stone-600">{{
                      n.body
                    }}</span>
                    <span class="mt-1 block text-xs text-stone-400">{{
                      relativeTime(n.createdAt)
                    }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        } @else {
          <app-empty-state class="p-4" [title]="i18n.t('notifications.empty')" />
        }
      </div>
    }
  `,
})
export default class NotificationBell {
  protected readonly i18n = inject(I18nStore);
  private readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly unread = this.store.unread;
  protected readonly items = this.store.items;
  protected readonly loading = this.store.loading;
  protected readonly error = this.store.error;

  protected readonly open = signal(false);
  protected readonly relativeTime = formatRelativeTime;

  protected readonly badgeText = computed(() =>
    this.unread() > BADGE_MAX ? `${BADGE_MAX}+` : String(this.unread()),
  );

  // Sama liczba w plakietce czyta się jako „Powiadomienia 3" — czytnik ekranu ma usłyszeć,
  // czego ta liczba dotyczy (plakietka „oczekujących" w nawigacji tego nie robi).
  protected readonly triggerLabel = computed(() => {
    const count = this.unread();
    if (count === 0) return translate('notifications.trigger.none');
    return translate('notifications.trigger.withCount', {
      unread: translatePlural('notifications.unreadCount', count),
    });
  });

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      // lista pobierana przy każdym otwarciu, nie raz: licznik mógł w tym czasie urosnąć
      void this.store.loadList();
    }
  }

  protected onRetry(): void {
    void this.store.loadList();
  }

  protected onMarkAll(): void {
    void this.store.markAllRead();
  }

  /** Klik poza dzwoneczkiem zamyka panel — bez oddawania fokusu, bo użytkownik jest już indziej. */
  protected onDocumentClick(event: Event): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  protected closeAndRefocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onSelect(event: MouseEvent, notification: AppNotification): void {
    void this.store.markRead(notification.id);

    // modyfikatory i klik inny niż lewy zostawiamy przeglądarce (nowa karta/okno) — panel
    // wtedy zostaje otwarty, bo strona się nie zmienia
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;

    event.preventDefault();
    this.open.set(false);
    void this.router.navigateByUrl(notification.url);
  }
}
