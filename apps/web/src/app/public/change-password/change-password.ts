import { Component, inject, signal } from '@angular/core';
import { apply, form, required, validate } from '@angular/forms/signals';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import { translate } from '../../core/i18n/translate';
import AppFormField, {
  passwordSchema,
  submitAuthForm,
} from '../form-field/form-field';

/**
 * Zmiana hasła przez zalogowanego (#146). Ten sam ekran obsługuje dwa wejścia: własną decyzję
 * użytkownika i wymuszenie po założeniu konta przez administratora (#144) — różni je tylko
 * komunikat u góry, bo czynność jest ta sama, a osobny ekran byłby duplikatem formularza.
 *
 * Powtórzenie hasła jest wyłącznie po stronie klienta: backend przyjmuje `newPassword` raz,
 * a pole istnieje po to, żeby literówka w haśle, którego się nie widzi, nie zamknęła konta.
 */
@Component({
  selector: 'app-change-password',
  imports: [AppFormField],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">
          {{
            auth.mustChangePassword()
              ? i18n.t('auth.changePassword.forcedTitle')
              : i18n.t('auth.changePassword.title')
          }}
        </h1>
        <p class="mt-1 text-sm text-stone-500">
          {{
            auth.mustChangePassword()
              ? i18n.t('auth.changePassword.forcedSubtitle')
              : i18n.t('auth.changePassword.subtitle')
          }}
        </p>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <app-form-field
            [field]="changeForm.currentPassword"
            fieldId="currentPassword"
            [label]="i18n.t('auth.field.currentPassword')"
            type="password"
            autocomplete="current-password"
          />
          <app-form-field
            class="mt-4"
            [field]="changeForm.newPassword"
            fieldId="newPassword"
            [label]="i18n.t('auth.field.newPassword')"
            type="password"
            autocomplete="new-password"
          />
          <app-form-field
            class="mt-4"
            [field]="changeForm.confirmPassword"
            fieldId="confirmPassword"
            [label]="i18n.t('auth.field.confirmPassword')"
            type="password"
            autocomplete="new-password"
          />

          <button
            type="submit"
            [disabled]="changeForm().submitting()"
            class="btn-primary mt-6"
          >
            {{
              changeForm().submitting()
                ? i18n.t('auth.changePassword.submitting')
                : i18n.t('auth.changePassword.submit')
            }}
          </button>
        </form>
      </section>
    </div>
  `,
})
export default class ChangePassword {
  protected readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  protected readonly model = signal({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  protected readonly serverError = signal<string | null>(null);

  protected readonly changeForm = form(this.model, (p) => {
    required(p.currentPassword, {
      message: () => translate('validation.currentPassword.required'),
    });
    apply(p.newPassword, passwordSchema);
    // reguła siedzi na polu powtórzenia, nie na formularzu: błąd ma się pokazać pod tym
    // polem, które użytkownik ma poprawić
    validate(p.confirmPassword, ({ value, valueOf }) =>
      value() === valueOf(p.newPassword)
        ? null
        : {
            kind: 'passwordMismatch',
            message: translate('validation.confirmPassword.mismatch'),
          },
    );
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.changeForm, this.serverError, () =>
      this.auth.changePassword({
        currentPassword: this.model().currentPassword,
        newPassword: this.model().newPassword,
      }),
    );
  }
}
