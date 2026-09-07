import { Component, computed, inject, signal } from '@angular/core';
import { apply, form, required, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage, isApiStatus } from '../core/api-client';
import {
  AuthStore,
  type UserProfile,
  type UserRole,
} from '../core/auth/auth-store';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import AppFormField, {
  emailSchema,
  submitAuthForm,
} from '../public/form-field/form-field';

/** Lustro `@Roles(CLIENT, OWNER)` z `UsersController.patchMyEmail` (#167). Czyta to ustawienia
 *  konta, żeby sekcji **nie renderować** dla pracownika i administratora: ich adres jest
 *  tożsamością nadaną przez organizację (ADR-0003), więc formularz schowany pod błędem `403`
 *  obiecywałby czynność, której nie ma. */
export function canChangeEmail(role: UserRole | null | undefined): boolean {
  return role === 'CLIENT' || role === 'OWNER';
}

/** Lustro `normalizeEmail` z apps/api (`common/credentials.ts`) — te same dwie operacje, bo
 *  po nich backend porównuje adresy i po nich szuka loginu. */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Komunikat błędu zapisu po statusie, a nie po zdaniu z serwera.
 *
 * `apiErrorMessage` przepuszcza polski `message` tylko przy polskim interfejsie, a przy
 * angielskim tłumaczy po kodzie — `CONFLICT` daje wtedy „dane się zmieniły, odśwież stronę",
 * co przy zajętym adresie jest nieprawdą i radą prowadzącą w złą stronę. Oba statusy mają tu
 * więc własny klucz, w obu językach:
 *  - `409` — nowy adres należy do innego konta,
 *  - `400` — złe obecne hasło; pozostałe powody `400` z API (niezgodne powtórzenie, adres równy
 *    obecnemu) łapie walidacja przed wysyłką, więc do serwera nie docierają.
 * Cokolwiek innego (429 z throttlera, 500, brak sieci) zostaje przy komunikacie ogólnym.
 */
function saveErrorMessage(err: unknown): string {
  if (isApiStatus(err, 409)) return translate('account.email.error.taken');
  if (isApiStatus(err, 400)) return translate('account.email.error.password');
  return apiErrorMessage(err);
}

/**
 * Sekcja „Adres e-mail" ustawień konta (#168) — ostatnia z czterech, z własnym przyciskiem
 * zapisu, bo `PATCH /users/me/email` kończy się inaczej niż każdy inny zapis na tym ekranie:
 * kasuje sesję.
 *
 * Powtórzenie adresu nie jest ozdobą. Zmiana wchodzi natychmiast i nieodwracalnie (ADR-0003),
 * a po wylogowaniu nie ma jak wrócić — literówka odcina od konta do resetu hasła przez
 * wsparcie. Porównujemy je po normalizacji, tak jak backend: różnica wielkości liter i
 * przypadkowe spacje dają ten sam login, więc nie są literówką.
 *
 * Adres równy obecnemu łapiemy tutaj, choć backend odrzuca go swoim `400`: obie te odpowiedzi
 * mają ten sam kod `BAD_REQUEST`, a angielski interfejs tłumaczy błędy po kodzie, nie po
 * polskim zdaniu z serwera (`apiErrorMessage`) — bez reguły po stronie klienta „ten sam adres"
 * i „złe hasło" byłyby w EN nierozróżnialne.
 *
 * Ostrzeżenie o wylogowaniu stoi nad formularzem, a nie w potwierdzeniu po zapisie: zaskoczenie
 * wylogowaniem wygląda jak awaria, a wtedy jest już za późno, żeby zmienić decyzję.
 */
@Component({
  selector: 'app-email-address',
  imports: [AppFormField],
  template: `
    <section>
      <h2 class="text-lg font-bold">{{ i18n.t('account.email.title') }}</h2>
      <p class="mt-1 text-sm text-stone-500">
        {{ i18n.t('account.email.subtitle') }}
      </p>

      @if (currentEmail(); as email) {
        <p class="mt-3 text-sm">
          {{ i18n.t('account.email.current') }}
          <span class="font-semibold">{{ email }}</span>
        </p>
      }

      <!-- ostrzeżenie, nie błąd: mówi, co się stanie po zapisie, więc ma być widoczne
           od wejścia i nie może wyglądać na coś, co użytkownik zepsuł -->
      <p
        id="emailChangeWarning"
        class="mt-4 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-700"
      >
        {{ i18n.t('account.email.warning') }}
      </p>

      @if (serverError(); as msg) {
        <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
      }

      <form class="mt-6" novalidate (submit)="onSubmit($event)">
        <app-form-field
          [field]="emailForm.newEmail"
          fieldId="newEmail"
          [label]="i18n.t('account.email.new')"
          type="email"
          autocomplete="email"
        />
        <app-form-field
          class="mt-4"
          [field]="emailForm.newEmailConfirm"
          fieldId="newEmailConfirm"
          [label]="i18n.t('account.email.confirm')"
          type="email"
          autocomplete="email"
        />
        <app-form-field
          class="mt-4"
          [field]="emailForm.currentPassword"
          fieldId="emailCurrentPassword"
          [label]="i18n.t('auth.field.currentPassword')"
          type="password"
          autocomplete="current-password"
        />

        <!-- ostrzeżenie spięte z przyciskiem: czytnik ekranu ma je usłyszeć na przycisku
             bez powrotu do tekstu nad formularzem -->
        <button
          type="submit"
          aria-describedby="emailChangeWarning"
          [disabled]="emailForm().submitting()"
          class="btn-primary mt-6"
        >
          {{
            emailForm().submitting()
              ? i18n.t('account.email.submitting')
              : i18n.t('account.email.submit')
          }}
        </button>
      </form>
    </section>
  `,
})
export default class EmailAddress {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  /** Obecny adres: najpierw profil (świeższy), a gdy jego ciche pobranie nie wróciło —
   *  adres z access tokenu. Zawsze coś jest, więc reguła „ten sam adres" nie ma dziury:
   *  token wygasa po 15 minutach, a zmiana loginu i tak kończy sesję, więc nie zdąży
   *  się rozjechać z bazą. */
  protected readonly currentEmail = computed(
    () => this.auth.profile()?.email ?? this.auth.user()?.email ?? null,
  );

  protected readonly model = signal({
    newEmail: '',
    newEmailConfirm: '',
    currentPassword: '',
  });
  protected readonly serverError = signal<string | null>(null);

  protected readonly emailForm = form(this.model, (p) => {
    apply(p.newEmail, emailSchema);
    validate(p.newEmail, ({ value }) => {
      const current = this.currentEmail();
      return current && normalizeEmail(value()) === normalizeEmail(current)
        ? {
            kind: 'sameAsCurrent',
            message: translate('validation.email.sameAsCurrent'),
          }
        : null;
    });
    apply(p.newEmailConfirm, emailSchema);
    // reguła na polu powtórzenia, nie na formularzu: błąd ma stać pod polem do poprawienia
    validate(p.newEmailConfirm, ({ value, valueOf }) =>
      normalizeEmail(value()) === normalizeEmail(valueOf(p.newEmail))
        ? null
        : {
            kind: 'emailMismatch',
            message: translate('validation.email.mismatch'),
          },
    );
    required(p.currentPassword, {
      message: () => translate('validation.currentPassword.required'),
    });
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.emailForm, this.serverError, async () => {
      try {
        // wysyłamy wpisane wartości, nie znormalizowane: normalizacja jest kontraktem backendu
        // (ADR-0003), a jej kopia po stronie klienta służy tu wyłącznie porównaniom
        await firstValueFrom(
          this.api.patch<UserProfile>('/users/me/email', this.model()),
        );
      } catch (err: unknown) {
        // `submitAuthForm` sam zamienia błąd na `apiErrorMessage`, a ten gubi w EN różnicę
        // między „adres zajęty" i „złe hasło" — dlatego komunikat ustawiamy tutaj
        this.serverError.set(saveErrorMessage(err));
        return;
      }
      // od tej chwili konto ma nowy login, a wszystkie refresh tokeny są usunięte — trzymanie
      // sesji dawałoby tylko ekrany sypiące się na pierwszym żądaniu
      await this.auth.finishEmailChange();
    });
  }
}
