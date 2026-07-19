import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  email,
  form,
  maxLength,
  minLength,
  pattern,
  required,
} from '@angular/forms/signals';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, {
  EMAIL_WITH_TLD,
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
        <h1 class="text-2xl font-bold">Rejestracja</h1>
        <p class="mt-1 text-sm text-stone-500">Załóż konto w BookIt</p>

        @if (serverError(); as msg) {
          <p
            role="alert"
            class="mt-4 rounded-lg bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-600"
          >
            {{ msg }}
          </p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <div class="grid grid-cols-2 gap-4">
            <app-form-field
              [field]="registerForm.firstName"
              fieldId="firstName"
              label="Imię"
              autocomplete="given-name"
            />
            <app-form-field
              [field]="registerForm.lastName"
              fieldId="lastName"
              label="Nazwisko"
              autocomplete="family-name"
            />
          </div>
          <app-form-field
            class="mt-4"
            [field]="registerForm.email"
            fieldId="email"
            label="Email"
            type="email"
            autocomplete="email"
          />
          <app-form-field
            class="mt-4"
            [field]="registerForm.password"
            fieldId="password"
            label="Hasło"
            type="password"
            autocomplete="new-password"
          />

          <button
            type="submit"
            [disabled]="registerForm().submitting()"
            class="mt-6 w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          >
            {{
              registerForm().submitting() ? 'Rejestracja…' : 'Zarejestruj się'
            }}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Masz już konto?
          <a
            routerLink="/login"
            class="font-medium text-brand-700 hover:text-brand-800"
            >Zaloguj się</a
          >
        </p>
      </section>
    </div>
  `,
})
export default class Register {
  private readonly auth = inject(AuthStore);

  protected readonly model = signal({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  protected readonly serverError = signal<string | null>(null);

  protected readonly registerForm = form(this.model, (p) => {
    required(p.firstName, { message: 'Imię jest wymagane' });
    required(p.lastName, { message: 'Nazwisko jest wymagane' });
    required(p.email, { message: 'Email jest wymagany' });
    email(p.email, { message: 'Nieprawidłowy format adresu email' });
    pattern(p.email, EMAIL_WITH_TLD, {
      message: 'Nieprawidłowy format adresu email',
    });
    required(p.password, { message: 'Hasło jest wymagane' });
    minLength(p.password, 8, {
      message: 'Hasło musi mieć co najmniej 8 znaków',
    });
    maxLength(p.password, 72, {
      message: 'Hasło może mieć maksymalnie 72 znaki',
    });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.registerForm, this.serverError, () =>
      this.auth.register(this.model()),
    );
  }
}
