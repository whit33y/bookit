import { Component, input } from '@angular/core';

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
      {{ message() }}
    </p>
  `,
})
export default class LoadingState {
  readonly message = input('Ładowanie…');
  /** Odstęp zależy od kontekstu — pełny ekran centruje pionowo, wiersz w karcie nie. */
  readonly paddingClass = input('');
}
