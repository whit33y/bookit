import { Component, input } from '@angular/core';

/**
 * Pusty wynik — świadomie osobny stan od błędu pobrania (#45). Bez tego rozdziału użytkownik
 * po nieudanym żądaniu czyta „nie masz jeszcze nic", co jest nieprawdą.
 *
 * `boxed` włącza wariant kartowy dla ekranów, gdzie pustka jest głównym widokiem strony
 * (wyniki wyszukiwania, tabele admina); domyślnie to zwykły akapit wewnątrz istniejącej karty.
 * `<ng-content>` przyjmuje CTA — link „Wróć do wyszukiwania", przycisk „Wróć na pierwszą stronę".
 */
@Component({
  selector: 'app-empty-state',
  host: { class: 'block' },
  // jeden `<ng-content />` na cały szablon: przy dwóch takich samych slotach Angular wypełnia
  // tylko pierwszy, więc CTA zniknęłoby w jednym z wariantów
  template: `
    <div
      [class]="
        boxed() ? 'rounded-xl border border-stone-200 bg-stone-50 p-8 text-center' : ''
      "
    >
      <p [class]="boxed() ? 'font-medium' : 'text-sm text-stone-500'">{{ title() }}</p>
      @if (description()) {
        <p class="mt-1 text-sm text-stone-500">{{ description() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export default class EmptyState {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly boxed = input(false);
}
