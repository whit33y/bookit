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
import { I18nStore } from '../../core/i18n/i18n-store';
import AppFormField, {
  passwordSchema,
  submitAuthForm,
} from '../form-field/form-field';

// kontrakt z backendowym auth.service.ts — tylko ten 400 oznacza zużyty/wygasły token;
// inne 400 (np. przyszła walidacja DTO hasła) mają trafić do serverError.
// Celowo polski literał i celowo poza słownikiem (#57): to porównanie z odpowiedzią serwera,
// nie tekst dla użytkownika — przetłumaczony przestałby pasować.
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
            {{ i18n.t('auth.reset.expiredTitle') }}
          </h1>
          <p role="alert" class="alert-danger mt-4">
            {{ i18n.t('auth.reset.expiredBody') }}
          </p>
          <a routerLink="/forgot-password" class="btn-primary mt-6 block text-center"
            >{{ i18n.t('auth.reset.newLink') }}</a
          >
        } @else {
          <h1 class="text-2xl font-bold">{{ i18n.t('auth.reset.title') }}</h1>
          <p class="mt-1 text-sm text-stone-500">
            {{ i18n.t('auth.reset.subtitle') }}
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
              [label]="i18n.t('auth.field.newPassword')"
              type="password"
              autocomplete="new-password"
            />

            <button
              type="submit"
              [disabled]="resetForm().submitting()"
              class="btn-primary mt-6"
            >
              {{
                resetForm().submitting()
                  ? i18n.t('auth.reset.submitting')
                  : i18n.t('auth.reset.submit')
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
  protected readonly i18n = inject(I18nStore);
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
