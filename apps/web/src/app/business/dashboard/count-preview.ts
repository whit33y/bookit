import { Component, input } from '@angular/core';

/** Jedna pozycja próbki. `secondary` jest opcjonalne — lista imion nie ma drugiej linii. */
export interface PreviewItem {
  id: string;
  primary: string;
  secondary?: string;
}

/**
 * Podgląd „licznik + próbka listy" (#135) — wspólne wnętrze kafelków, które podsumowują
 * zbiór: liczba na górze, pod nią kilka pozycji na przykład.
 *
 * Komponent jest czysto prezentacyjny: liczenie, wybór próbki i formatowanie zostają
 * w kafelku, bo każdy liczy co innego (aktywne usługi, aktywni pracownicy, oczekujące
 * rezerwacje). Wspólny jest tylko układ i to, że pozycje są ucinane, a nie zawijane —
 * kafelki w siatce muszą mieć przewidywalną wysokość.
 *
 * `note` to drugi wiersz nagłówka na dopowiedzenie do liczby („Nieaktywni: 2"). Nie ma go
 * jako pozycji listy, bo nie jest przykładem — jest częścią licznika.
 *
 * Kafelek ustawień z tego nie korzysta: pokazuje pola jednej firmy, nie liczbę i próbkę
 * zbioru, więc wspólny byłby tam tylko import.
 */
@Component({
  selector: 'app-dashboard-count-preview',
  host: { class: 'block' },
  template: `
    <p class="font-semibold">{{ headline() }}</p>
    @if (note()) {
      <p class="text-stone-500">{{ note() }}</p>
    }

    <ul class="mt-3 flex flex-col gap-2">
      @for (item of items(); track item.id) {
        <li class="min-w-0">
          <span class="block truncate font-medium">{{ item.primary }}</span>
          @if (item.secondary) {
            <span class="block truncate text-stone-600">{{
              item.secondary
            }}</span>
          }
        </li>
      }
    </ul>
  `,
})
export default class CountPreview {
  readonly headline = input.required<string>();
  readonly note = input('');
  readonly items = input.required<readonly PreviewItem[]>();
}
