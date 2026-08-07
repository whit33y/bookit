import { Component, inject, input } from '@angular/core';
import { I18nStore } from '../../core/i18n/i18n-store';

/**
 * Stan ładowania listy albo całego ekranu (#45). `role="status"` sprawia, że czytnik ekranu
 * ogłasza „Ładowanie…" bez zabierania fokusu — wcześniej część loaderów była zwykłym `<p>`
 * i użytkownik czytnika nie dowiadywał się, że coś się dzieje.
 */
@Component({
  selector: 'app-loading-state',
  host: { class: 'block' },
  template: `
    <p role="status" class="text-sm text-stone-500" [class]="paddingClass()">
      {{ message() || i18n.t('ui.loading') }}
    </p>
  `,
})
export default class LoadingState {
  protected readonly i18n = inject(I18nStore);

  /** Pusty domyślny zamiast literału: wartość domyślna `input()` powstaje raz, przy tworzeniu
   *  komponentu, więc nie nadążyłaby za zmianą języka — fallback musi żyć w szablonie (#57). */
  readonly message = input('');
  /** Odstęp zależy od kontekstu — pełny ekran centruje pionowo, wiersz w karcie nie. */
  readonly paddingClass = input('');
}
