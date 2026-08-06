import { Component, inject, input, output } from '@angular/core';
import { I18nStore } from '../../core/i18n/i18n-store';

/**
 * Nieudane pobranie danych (#45). Komunikat zawsze przechodzi przez `apiErrorMessage()`, więc
 * jest w języku UI (#57) i nigdy nie jest surową treścią odpowiedzi.
 *
 * `role="alert"` ogłasza błąd od razu po pojawieniu się. Retry jest opcjonalny: ma sens tylko
 * tam, gdzie da się powtórzyć dokładnie to samo żądanie bez udziału użytkownika.
 */
@Component({
  selector: 'app-error-state',
  host: { class: 'block' },
  template: `
    <p role="alert" class="alert-danger">{{ message() }}</p>
    @if (retryable()) {
      <button type="button" class="btn-primary mt-4 w-auto" (click)="retry.emit()">
        {{ i18n.t('ui.retry') }}
      </button>
    }
  `,
})
export default class ErrorState {
  protected readonly i18n = inject(I18nStore);

  readonly message = input.required<string>();
  readonly retryable = input(false);
  readonly retry = output<void>();
}
