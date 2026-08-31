import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';

/**
 * Stan podglądu kafelka. Kafelek jest prezentacyjny — o stanie decyduje ten, kto pobiera dane.
 *
 * `empty` i `warning` niosą to samo (komunikat + CTA) i różnią się wyłącznie wagą: brak wizyt
 * na dziś jest normalny, brak aktywnych usług czy pracowników znaczy, że klient niczego nie
 * zarezerwuje (#135). Dlatego oba czytają te same `noticeTitle`/`noticeCta`.
 */
export type TileState = 'loading' | 'error' | 'empty' | 'warning' | 'content';

/**
 * Skorupa kafelka pulpitu firmy (#132): tytuł, link na całości i slot na podgląd danych.
 * Każdy kafelek pobiera dane sam (#133–#135), więc stany są per kafelek, nie per strona —
 * błąd statystyk nie może zabrać z ekranu kalendarza.
 *
 * „Cały kafelek jest linkiem" realizuje wzorzec stretched link: pseudoelement `after:inset-0`
 * anchora przykrywa kartę, zamiast opakowywać ją w `<a>`. Dzięki temu w kafelku mogą stać
 * nagłówek i treść (opakowanie w link dawałoby nagłówek wewnątrz odnośnika i, gdyby podgląd
 * kiedyś dostał własny odnośnik, link w linku). Warstwa podglądu jest statycznie pozycjonowana,
 * więc nakładka rysuje się nad nią i klik w dowolne miejsce karty prowadzi na podstronę.
 *
 * Wyjątkiem jest `app-error-state`: ma `relative`, żeby wyjść nad nakładkę i dać się kliknąć.
 * To jedyny dodatkowy przystanek tabulatora w kafelku i jedyna akcja — ponowienie pobrania nie
 * jest decyzją biznesową (te zapadają na podstronach), tylko naprawą nieudanego żądania.
 * CTA w stanie pustym i ostrzegawczym jest z tego powodu tekstem, a nie odnośnikiem — kafelek
 * już tam prowadzi.
 */
@Component({
  selector: 'app-dashboard-tile',
  imports: [RouterLink, LoadingState, ErrorState, EmptyState],
  host: { class: 'block h-full' },
  template: `
    <article
      class="relative flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-card transition hover:border-brand-200 hover:shadow-lifted has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand-600 has-[a:focus-visible]:ring-offset-2"
    >
      <h2 class="text-base font-bold tracking-tight">
        <a
          [routerLink]="link()"
          class="flex items-center justify-between gap-3 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {{ heading() }}
          <span aria-hidden="true" class="text-stone-400">›</span>
        </a>
      </h2>

      <div class="mt-4 flex-1 text-sm">
        @switch (state()) {
          @case ('loading') {
            <app-loading-state />
          }
          @case ('error') {
            <app-error-state
              class="relative"
              [message]="errorMessage()"
              [retryable]="true"
              (retry)="retry.emit()"
            />
          }
          @case ('empty') {
            <app-empty-state [title]="noticeTitle()">
              @if (noticeCta(); as cta) {
                <span
                  class="mt-2 inline-block text-sm font-semibold text-brand-700"
                  >{{ cta }} ›</span
                >
              }
            </app-empty-state>
          }
          @case ('warning') {
            <!-- Bursztyn jak plakietka statusu PENDING, ale ostrzeżenie niesie treść zdania,
                 nie kolor — sam odcień nie mówi nic czytnikowi ekranu (WCAG 1.4.1). -->
            <p
              class="rounded-lg bg-amber-50 px-3.5 py-2.5 font-medium text-amber-700"
            >
              {{ noticeTitle() }}
              @if (noticeCta(); as cta) {
                <span class="mt-1 block font-semibold">{{ cta }} ›</span>
              }
            </p>
          }
          @default {
            <ng-content />
          }
        }
      </div>
    </article>
  `,
})
export default class DashboardTile {
  /** Tytuł kafelka. Nie `title` — statyczny atrybut o tej nazwie trafiłby też do DOM-u
   *  i przeglądarka pokazywałaby dymek powielający nagłówek. */
  readonly heading = input.required<string>();
  /** Cel `routerLink` — podstrona, której kafelek jest podglądem. */
  readonly link = input.required<string>();
  readonly state = input<TileState>('content');
  /** Komunikat po `apiErrorMessage()`, jak w pozostałych ekranach panelu. */
  readonly errorMessage = input('');
  /** Komunikat stanu pustego albo ostrzeżenia — o wadze decyduje `state`, nie treść. */
  readonly noticeTitle = input('');
  /** Zachęta pod komunikatem, tekstem: kafelek jest już linkiem tam, gdzie ona prowadzi. */
  readonly noticeCta = input('');
  readonly retry = output<void>();
}
