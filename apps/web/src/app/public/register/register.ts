import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apply, form } from '@angular/forms/signals';
import { AuthStore } from '../../core/auth/auth-store';
import { I18nStore } from '../../core/i18n/i18n-store';
import AppFormField, {
  emailSchema,
  passwordSchema,
  personNameSchema,
  submitAuthForm,
} from '../form-field/form-field';

@Component({
  selector: 'app-register',
  imports: [AppFormField, RouterLink],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">{{ i18n.t('auth.register.title') }}</h1>
        <p class="mt-1 text-sm text-stone-500">
          {{ i18n.t('auth.register.subtitle') }}
        </p>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">
            {{ msg }}
          </p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <div class="grid grid-cols-2 gap-4">
            <app-form-field
              [field]="registerForm.firstName"
              fieldId="firstName"
              [label]="i18n.t('auth.field.firstName')"
              autocomplete="given-name"
            />
            <app-form-field
              [field]="registerForm.lastName"
              fieldId="lastName"
              [label]="i18n.t('auth.field.lastName')"
              autocomplete="family-name"
            />
          </div>
          <app-form-field
            class="mt-4"
            [field]="registerForm.email"
            fieldId="email"
            [label]="i18n.t('auth.field.email')"
            type="email"
            autocomplete="email"
          />
          <app-form-field
            class="mt-4"
            [field]="registerForm.password"
            fieldId="password"
            [label]="i18n.t('auth.field.password')"
            type="password"
            autocomplete="new-password"
          />

          <button
            type="submit"
            [disabled]="registerForm().submitting()"
            class="btn-primary mt-6"
          >
            {{
              registerForm().submitting()
                ? i18n.t('auth.register.submitting')
                : i18n.t('auth.register.submit')
            }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          {{ i18n.t('auth.register.hasAccount') }}
          <a
            routerLink="/login"
            [queryParams]="returnUrl ? { returnUrl } : {}"
            class="font-medium text-brand-700 hover:text-brand-800"
            >{{ i18n.t('auth.register.loginLink') }}</a
          >
        </p>
      </section>
    </div>
  `,
})
export default class Register {
  private readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  /** Cel powrotu po rejestracji — przeniesiony z /login, żeby przełączenie formularza
   *  nie gubiło kontekstu (np. niedokończonej rezerwacji). */
  protected readonly returnUrl = inject(ActivatedRoute).snapshot.queryParamMap.get(
    'returnUrl',
  );

  protected readonly model = signal({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  protected readonly serverError = signal<string | null>(null);

  protected readonly registerForm = form(this.model, (p) => {
    apply(p.firstName, personNameSchema('firstName'));
    apply(p.lastName, personNameSchema('lastName'));
    apply(p.email, emailSchema);
    apply(p.password, passwordSchema);
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.registerForm, this.serverError, () =>
      this.auth.register(this.model(), this.returnUrl),
    );
  }
}
