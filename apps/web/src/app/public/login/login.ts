import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { email, form, pattern, required } from '@angular/forms/signals';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, {
  EMAIL_WITH_TLD,
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
          <p
            role="alert"
            class="mt-4 rounded-lg bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-600"
          >
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

          <button
            type="submit"
            [disabled]="loginForm().submitting()"
            class="mt-6 w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          >
            {{ loginForm().submitting() ? 'Logowanie…' : 'Zaloguj się' }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Nie masz konta?
          <a
            routerLink="/register"
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

  protected readonly model = signal({ email: '', password: '' });
  protected readonly serverError = signal<string | null>(null);

  protected readonly loginForm = form(this.model, (p) => {
    required(p.email, { message: 'Email jest wymagany' });
    email(p.email, { message: 'Nieprawidłowy format adresu email' });
    pattern(p.email, EMAIL_WITH_TLD, {
      message: 'Nieprawidłowy format adresu email',
    });
    required(p.password, { message: 'Hasło jest wymagane' });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.loginForm, this.serverError, () =>
      this.auth.login(this.model()),
    );
  }
}
