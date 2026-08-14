import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { I18nStore } from '../../core/i18n/i18n-store';
import AccountItems from './account-items';

/**
 * Sekcja konta w pasku desktopowym (#125): przycisk z ikoną rozwijający panel z pozycjami
 * z `account-items.ts`. Poniżej `md` całość mieszka w panelu hamburgera, który wstawia te
 * same pozycje bezpośrednio — dlatego rozwijanie jest tutaj, a nie w komponencie z treścią:
 * inaczej egzemplarz w hamburgerze wiązałby listenery Escape i `document:click` do stanu,
 * którego nigdy nie ma.
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
  imports: [AccountItems],
  host: {
    class: 'relative inline-block',
    '(keydown.escape)': 'closeAndRefocus($event)',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
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
        class="absolute right-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white p-1.5 shadow-raised"
      >
        <app-account-items (selected)="close()" />
      </div>
    }
  `,
})
export default class UserMenu {
  protected readonly i18n = inject(I18nStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** Klik poza menu zamyka panel — bez oddawania fokusu, bo użytkownik jest już indziej. */
  protected onDocumentClick(event: Event): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  protected closeAndRefocus(event: Event): void {
    if (!this.open()) return;
    // zamykamy tylko wierzchnią warstwę: bez tego to samo naciśnięcie zwinęłoby też panel
    // hamburgera (`App` słucha Escape na dokumencie) i przeniosło fokus na hamburger
    event.stopPropagation();
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }
}
