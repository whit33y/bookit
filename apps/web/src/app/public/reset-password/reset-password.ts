import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apply, form } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import AppFormField, {
  passwordSchema,
  submitAuthForm,
} from '../form-field/form-field';

// kontrakt z backendowym auth.service.ts — tylko ten 400 oznacza zużyty/wygasły token;
// inne 400 (np. przyszła walidacja DTO hasła) mają trafić do serverError
const EXPIRED_TOKEN_MESSAGE = 'Nieprawidłowy lub wygasły token';

const isExpiredTokenError = (err: unknown) =>
  err instanceof HttpErrorResponse &&
  err.status === 400 &&
  err.error?.message === EXPIRED_TOKEN_MESSAGE;

@Component({
  selector: 'app-reset-password',
  imports: [AppFormField, RouterLink],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        @if (tokenError()) {
          <h1
            #errorHeading
            tabindex="-1"
            class="text-2xl font-bold outline-none"
          >
            Link nieaktywny
          </h1>
          <p role="alert" class="alert-danger mt-4">
            Link do resetu hasła wygasł lub został już użyty.
          </p>
          <a routerLink="/forgot-password" class="btn-primary mt-6 block text-center"
            >Wyślij nowy link</a
          >
        } @else {
          <h1 class="text-2xl font-bold">Ustaw nowe hasło</h1>
          <p class="mt-1 text-sm text-stone-500">
            Wpisz nowe hasło do swojego konta
          </p>

          @if (serverError(); as msg) {
            <p role="alert" class="alert-danger mt-4">
              {{ msg }}
            </p>
          }

          <form class="mt-6" novalidate (submit)="onSubmit($event)">
            <app-form-field
              [field]="resetForm.password"
              fieldId="password"
              label="Nowe hasło"
              type="password"
              autocomplete="new-password"
            />

            <button
              type="submit"
              [disabled]="resetForm().submitting()"
              class="btn-primary mt-6"
            >
              {{
                resetForm().submitting() ? 'Zapisywanie…' : 'Ustaw nowe hasło'
              }}
            </button>
          </form>
        }
      </section>
    </div>
  `,
})
export default class ResetPassword {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly token =
    inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  private readonly errorHeading =
    viewChild<ElementRef<HTMLElement>>('errorHeading');

  protected readonly model = signal({ password: '' });
  // brak tokenu w URL (link uszkodzony/wklejony bez parametru) = od razu stan błędu
  protected readonly tokenError = signal(this.token === '');
  protected readonly serverError = signal<string | null>(null);

  protected readonly resetForm = form(this.model, (p) => {
    apply(p.password, passwordSchema);
  });

  constructor() {
    // WCAG focus management: błąd tokenu niszczy gałąź z fokusowanym przyciskiem,
    // więc przenosimy fokus na nagłówek nowego widoku
    effect(() => this.errorHeading()?.nativeElement.focus());
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.resetForm, this.serverError, async () => {
      try {
        await firstValueFrom(
          this.api.post<{ message: string }>('/auth/reset-password', {
            token: this.token,
            password: this.model().password,
          }),
        );
        // backend unieważnił wszystkie sesje — czyścimy lokalną, logout nawiguje na /login
        // (goły navigate odbiłby się o guestGuard przy żywej sesji)
        this.auth.logout();
      } catch (err) {
        if (isExpiredTokenError(err)) {
          this.tokenError.set(true);
        } else {
          throw err; // pozostałe błędy → serverError przez submitAuthForm
        }
      }
    });
  }
}
