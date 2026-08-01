import { Component, input, output } from '@angular/core';

/**
 * Nieudane pobranie danych (#45, AC „główne ścieżki obsługują błędy API komunikatem po polsku").
 * Komunikat zawsze przechodzi przez `apiErrorMessage()`, więc jest po polsku i nigdy nie jest
 * surową treścią odpowiedzi.
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
        Spróbuj ponownie
      </button>
    }
  `,
})
export default class ErrorState {
  readonly message = input.required<string>();
  readonly retryable = input(false);
  readonly retry = output<void>();
}
