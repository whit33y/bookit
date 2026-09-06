import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import { personMonogram } from '../monogram';
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
 * Przycisk nosi zdjęcie profilowe osoby (#164), a bez niego monogram (CONTEXT.md → „Wizerunek")
 * z imienia i nazwiska — jedno i drugie `AuthStore` trzyma z `GET /users/me` (#161), więc
 * wgranie zdjęcia w ustawieniach konta widać tu od razu. Ikona sylwetki zostaje stanem przejściowym:
 * profilu nie ma jeszcze zaraz po wejściu na stronę i nie będzie go wcale, gdy pobranie padnie
 * — inicjały z adresu e-mail udawałyby wtedy dane, których nie mamy.
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
      [attr.aria-label]="menuLabel()"
      (click)="toggle()"
      class="grid h-9 w-9 place-items-center rounded-full transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      @if (photo(); as src) {
        <!-- NgOptimizedImage nie wchodzi w grę: to nie jest statyczny zasób, tylko bajty
             spod /api, a wersja w adresie zmienia się przy każdym wgraniu -->
        <img
          [src]="src"
          alt=""
          aria-hidden="true"
          class="h-7 w-7 rounded-full object-cover ring-1 ring-inset ring-stone-200"
        />
      } @else {
        <span
          aria-hidden="true"
          class="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-200"
        >
          @if (monogram(); as initials) {
            {{ initials }}
          } @else {
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
          }
        </span>
      }
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
  private readonly auth = inject(AuthStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);

  /** Zdjęcie profilowe zalogowanego (#164); `null` spycha przycisk na monogram, a ten na
   *  ikonę sylwetki. Alt jest pusty, a element `aria-hidden`: czyje to menu, mówi już etykieta
   *  przycisku, a druga zapowiedź tej samej rzeczy tylko przedłużyłaby odczyt. */
  protected readonly photo = this.auth.profilePhoto;

  /** `''` (konto bez imienia i nazwiska) znaczy to samo, co brak profilu — pusty monogram
   *  byłby gorszy od ikony. */
  protected readonly monogram = computed(() => {
    const profile = this.auth.profile();
    return profile ? personMonogram(profile.firstName, profile.lastName) : '';
  });

  /** Czytnik ekranu dostaje z etykiety, czyje to menu — sam monogram jest aria-hidden,
   *  a przy kilku kontach w jednej przeglądarce „Menu użytkownika" nie mówi nic. */
  protected readonly menuLabel = computed(() => {
    const name = this.auth.fullName();
    return name
      ? this.i18n.t('nav.userMenuFor', { name })
      : this.i18n.t('nav.userMenu');
  });

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
