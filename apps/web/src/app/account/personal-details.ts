import { Component, inject, linkedSignal, signal } from '@angular/core';
import { apply, form, pattern } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { AuthStore, type UserProfile } from '../core/auth/auth-store';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import AppFormField, {
  personNameSchema,
  submitAuthForm,
} from '../public/form-field/form-field';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';

// Lustrzane do UpdateMeDto (apps/api) — imię i nazwisko biorą reguły z `personNameSchema`
// (ten sam NAME_MAX_LENGTH co przy rejestracji), telefon ten sam wzorzec co w firmie.
const PHONE = /^\+?[0-9\s-]{7,20}$/;

/**
 * Sekcja „Dane osobowe" ustawień konta (#162): imię, nazwisko i telefon — jedno
 * `PATCH /users/me` i jeden przycisk zapisu.
 *
 * Sekcja pobiera profil sama, zamiast czytać `AuthStore.profile()`: pobranie w store jest
 * ciche (nieudane zostawia `null`, bo menu ma wtedy po prostu mniej pokazać), a formularz
 * nie może na tym poprzestać — pusty formularz nad `PATCH`-em wyglądałby jak konto bez
 * imienia i skasowałby dane przy zapisie. Tutaj brak odpowiedzi jest błędem z ponowieniem.
 *
 * Zapisany profil wraca z `PATCH`-a i idzie do `AuthStore.setProfile`, więc imię w menu
 * użytkownika zmienia się od razu, bez drugiego żądania.
 */
@Component({
  selector: 'app-personal-details',
  imports: [AppFormField, ErrorState, LoadingState],
  template: `
    <section>
      <h2 class="text-lg font-bold">{{ i18n.t('account.personal.title') }}</h2>
      <p class="mt-1 text-sm text-stone-500">
        {{ i18n.t('account.personal.subtitle') }}
      </p>

      @if (loading()) {
        <app-loading-state class="mt-6" [message]="i18n.t('account.loading')" />
      } @else if (loadError(); as msg) {
        <app-error-state
          class="mt-4"
          [message]="msg"
          [retryable]="true"
          (retry)="load()"
        />
      } @else {
        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
        }
        @if (saved()) {
          <p
            role="status"
            class="mt-4 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700"
          >
            {{ i18n.t('account.personal.saved') }}
          </p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <app-form-field
            [field]="detailsForm.firstName"
            fieldId="firstName"
            [label]="i18n.t('auth.field.firstName')"
            autocomplete="given-name"
          />
          <app-form-field
            class="mt-4"
            [field]="detailsForm.lastName"
            fieldId="lastName"
            [label]="i18n.t('auth.field.lastName')"
            autocomplete="family-name"
          />
          <app-form-field
            class="mt-4"
            [field]="detailsForm.phone"
            fieldId="phone"
            [label]="i18n.t('account.personal.phone')"
            type="tel"
            autocomplete="tel"
          />

          <button
            type="submit"
            [disabled]="detailsForm().submitting()"
            class="btn-primary mt-6"
          >
            {{
              detailsForm().submitting()
                ? i18n.t('account.personal.saving')
                : i18n.t('account.personal.submit')
            }}
          </button>
        </form>
      }
    </section>
  `,
})
export default class PersonalDetails {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  protected readonly i18n = inject(I18nStore);

  protected readonly loading = signal(true);
  /** Błąd pobrania profilu (retry ma sens) — osobno od `serverError` zapisu, bo tylko on
   *  zastępuje cały formularz. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);

  protected readonly model = signal({
    firstName: '',
    lastName: '',
    phone: '',
  });

  /** Potwierdzenie zapisu, gaszone przez każdą kolejną edycję: „Zapisano" nad polem, które
   *  właśnie zmieniono, mówiłoby nieprawdę o tym, co jest w bazie. Stąd `linkedSignal`
   *  na modelu, a nie zwykły `signal` czyszczony przy submicie. */
  protected readonly saved = linkedSignal<unknown, boolean>({
    source: this.model,
    computation: () => false,
  });

  protected readonly detailsForm = form(this.model, (p) => {
    apply(p.firstName, personNameSchema('firstName'));
    apply(p.lastName, personNameSchema('lastName'));
    pattern(p.phone, PHONE, {
      message: () => translate('validation.phone.invalid'),
    });
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    firstValueFrom(this.api.get<UserProfile>('/users/me'))
      .then((profile) => {
        this.model.set({
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone ?? '',
        });
      })
      .catch((err: unknown) => {
        this.loadError.set(
          translate('account.error.load', { detail: apiErrorMessage(err) }),
        );
      })
      .finally(() => this.loading.set(false));
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.saved.set(false);
    await submitAuthForm(this.detailsForm, this.serverError, async () => {
      const m = this.model();
      // pusty telefon pomijamy — `@IsOptional` w DTO przepuszcza brak pola, ale pusty string
      // wywróciłby się na @Matches. Wyczyszczenie zapisanego numeru nie jest wspierane,
      // tak samo jak w ustawieniach firmy.
      const payload = {
        firstName: m.firstName,
        lastName: m.lastName,
        ...(m.phone ? { phone: m.phone } : {}),
      };
      const profile = await firstValueFrom(
        this.api.patch<UserProfile>('/users/me', payload),
      );
      // menu użytkownika czyta profil ze store'u — bez podmiany pokazywałoby stare imię
      this.auth.setProfile(profile);
      this.saved.set(true);
    });
  }
}
