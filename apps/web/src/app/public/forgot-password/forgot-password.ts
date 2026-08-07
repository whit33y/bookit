import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { apply, form } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { I18nStore } from '../../core/i18n/i18n-store';
import AppFormField, {
  emailSchema,
  submitAuthForm,
} from '../form-field/form-field';

@Component({
  selector: 'app-forgot-password',
  imports: [AppFormField, RouterLink],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        @if (sent()) {
          <h1 #sentHeading tabindex="-1" class="text-2xl font-bold outline-none">
            {{ i18n.t('auth.forgot.sentTitle') }}
          </h1>
          <p role="status" class="mt-4 text-sm text-stone-500">
            {{ i18n.t('auth.forgot.sentBody') }}
          </p>
          <p class="mt-6 text-center text-sm">
            <a
              routerLink="/login"
              class="font-medium text-brand-700 hover:text-brand-800"
              >{{ i18n.t('auth.backToLogin') }}</a
            >
          </p>
        } @else {
          <h1 class="text-2xl font-bold">{{ i18n.t('auth.forgot.title') }}</h1>
          <p class="mt-1 text-sm text-stone-500">
            {{ i18n.t('auth.forgot.subtitle') }}
          </p>

          @if (serverError(); as msg) {
            <p role="alert" class="alert-danger mt-4">
              {{ msg }}
            </p>
          }

          <form class="mt-6" novalidate (submit)="onSubmit($event)">
            <app-form-field
              [field]="forgotForm.email"
              fieldId="email"
              [label]="i18n.t('auth.field.email')"
              type="email"
              autocomplete="email"
            />

            <button
              type="submit"
              [disabled]="forgotForm().submitting()"
              class="btn-primary mt-6"
            >
              {{
                forgotForm().submitting()
                  ? i18n.t('auth.forgot.submitting')
                  : i18n.t('auth.forgot.submit')
              }}
            </button>
          </form>

          <p class="mt-6 text-center text-sm">
            <a
              routerLink="/login"
              class="font-medium text-brand-700 hover:text-brand-800"
              >{{ i18n.t('auth.backToLogin') }}</a
            >
          </p>
        }
      </section>
    </div>
  `,
})
export default class ForgotPassword {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly sentHeading =
    viewChild<ElementRef<HTMLElement>>('sentHeading');

  protected readonly model = signal({ email: '' });
  protected readonly sent = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly forgotForm = form(this.model, (p) => {
    apply(p.email, emailSchema);
  });

  constructor() {
    // WCAG focus management: sukces niszczy gałąź z fokusowanym przyciskiem,
    // więc przenosimy fokus na nagłówek nowego widoku
    effect(() => this.sentHeading()?.nativeElement.focus());
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.forgotForm, this.serverError, async () => {
      await firstValueFrom(
        this.api.post<{ message: string }>(
          '/auth/forgot-password',
          this.model(),
        ),
      );
      this.sent.set(true);
    });
  }
}
