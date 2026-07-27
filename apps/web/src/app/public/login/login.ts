import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apply, form, required } from '@angular/forms/signals';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, {
  emailSchema,
  submitAuthForm,
} from '../form-field/form-field';

@Component({
  selector: 'app-login',
  imports: [AppFormField, RouterLink],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">Logowanie</h1>
        <p class="mt-1 text-sm text-stone-500">Zaloguj się na swoje konto</p>

        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">
            {{ msg }}
          </p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <app-form-field
            [field]="loginForm.email"
            fieldId="email"
            label="Email"
            type="email"
            autocomplete="email"
          />
          <app-form-field
            class="mt-4"
            [field]="loginForm.password"
            fieldId="password"
            label="Hasło"
            type="password"
            autocomplete="current-password"
          />

          <p class="mt-2 text-right text-sm">
            <a
              routerLink="/forgot-password"
              class="font-medium text-brand-700 hover:text-brand-800"
              >Nie pamiętasz hasła?</a
            >
          </p>

          <button
            type="submit"
            [disabled]="loginForm().submitting()"
            class="btn-primary mt-6"
          >
            {{ loginForm().submitting() ? 'Logowanie…' : 'Zaloguj się' }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Nie masz konta?
          <a
            routerLink="/register"
            [queryParams]="returnUrl ? { returnUrl } : {}"
            class="font-medium text-brand-700 hover:text-brand-800"
            >Zarejestruj się</a
          >
        </p>
      </section>
    </div>
  `,
})
export default class Login {
  private readonly auth = inject(AuthStore);

  /** Cel powrotu po zalogowaniu — snapshot wystarczy, bo /login nie zmienia query paramów
   *  w trakcie życia komponentu. Walidację adresu robi AuthStore (safeReturnUrl). */
  protected readonly returnUrl = inject(ActivatedRoute).snapshot.queryParamMap.get(
    'returnUrl',
  );

  protected readonly model = signal({ email: '', password: '' });
  protected readonly serverError = signal<string | null>(null);

  protected readonly loginForm = form(this.model, (p) => {
    apply(p.email, emailSchema);
    required(p.password, { message: 'Hasło jest wymagane' });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.loginForm, this.serverError, () =>
      this.auth.login(this.model(), this.returnUrl),
    );
  }
}
