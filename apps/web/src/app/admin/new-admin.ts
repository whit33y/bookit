import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormField,
  apply,
  form,
  pattern,
  validate,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, isApiStatus } from '../core/api-client';
import { I18nStore } from '../core/i18n/i18n-store';
import { translate } from '../core/i18n/translate';
import AppFormField, {
  emailSchema,
  passwordSchema,
  personNameSchema,
  submitAuthForm,
} from '../public/form-field/form-field';
import { generatePassword } from './generate-password';

/** Przycisk drugorzędny — w `styles.css` jest tylko `.btn-primary`, a ten formularz ma
 *  cztery takie przyciski obok siebie. */
const SECONDARY_BUTTON =
  'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

const EMPTY_MODEL = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
};

// lustro CreateAdminUserDto (apps/api/src/app/admin/dto/create-admin-user.dto.ts)
const PHONE = /^\+?[0-9\s-]{7,20}$/;

/** Lustro `normalizeEmail` z backendu — API porównuje adresy po sprowadzeniu do jednej
 *  postaci, więc „Jan@Example.com" odrzucony jako zajęty musi zapalić błąd również dla
 *  „jan@example.com". */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Zakładanie konta kolejnego administratora (#146).
 *
 * Bez wyboru roli: formularz tworzy wyłącznie ADMIN-ów, bo każda inna rola ma już swoją drogę
 * (klient rejestruje się sam, właściciel powstaje z akceptacji zgłoszenia, pracownik z panelu
 * firmy) — select roli byłby drugą, sprzeczną (#144).
 *
 * Hasło można wpisać albo wygenerować. Wygenerowane odsłaniamy od razu: nikt go nie zna,
 * a administrator musi je przepisać i przekazać poza systemem. Wpisane ręcznie zostaje zakryte,
 * dopóki tworzący sam go nie odsłoni — hasło, które ktoś zna z głowy, bywa jego własnym.
 */
@Component({
  selector: 'app-new-admin',
  imports: [AppFormField, FormField, RouterLink],
  template: `
    <section
      class="mt-6 max-w-2xl rounded-xl border border-stone-200 bg-white p-6 shadow-card sm:p-8"
    >
      <h2 class="text-lg font-bold">{{ i18n.t('admin.newAdmin.title') }}</h2>
      <p class="mt-1 text-sm text-stone-500">
        {{ i18n.t('admin.newAdmin.subtitle') }}
      </p>

      @if (created(); as account) {
        <div
          role="status"
          class="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
        >
          <!-- fokusowalny nagłówek: sukces niszczy gałąź z fokusowanym przyciskiem „Utwórz
               konto", więc bez tego fokus spada na <body> (WCAG focus management) -->
          <p
            #createdHeading
            tabindex="-1"
            class="text-sm font-semibold text-emerald-800 outline-none"
          >
            {{ i18n.t('admin.newAdmin.created', { email: account.email }) }}
          </p>
          <p class="mt-1 text-[13px] text-emerald-800">
            {{ i18n.t('admin.newAdmin.createdHint') }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <code
              data-testid="created-password"
              class="select-all rounded-md border border-emerald-200 bg-white px-3 py-2 font-mono text-sm"
              >{{ account.password }}</code
            >
            <button
              type="button"
              [class]="secondaryButton"
              (click)="copy(account.password)"
            >
              {{ copyLabel() }}
            </button>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" class="btn-primary w-auto" (click)="addAnother()">
            {{ i18n.t('admin.newAdmin.another') }}
          </button>
          <a routerLink="/admin/users" [class]="secondaryButton">
            {{ i18n.t('admin.newAdmin.backToUsers') }}
          </a>
        </div>
      } @else {
        @if (serverError(); as msg) {
          <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
        }

        <form class="mt-6" novalidate (submit)="onSubmit($event)">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <app-form-field
              [field]="newAdminForm.firstName"
              fieldId="firstName"
              [label]="i18n.t('auth.field.firstName')"
              autocomplete="given-name"
            />
            <app-form-field
              [field]="newAdminForm.lastName"
              fieldId="lastName"
              [label]="i18n.t('auth.field.lastName')"
              autocomplete="family-name"
            />
          </div>

          <app-form-field
            class="mt-4"
            [field]="newAdminForm.email"
            fieldId="email"
            [label]="i18n.t('auth.field.email')"
            type="email"
            autocomplete="off"
          />

          <app-form-field
            class="mt-4"
            [field]="newAdminForm.phone"
            fieldId="phone"
            [label]="i18n.t('admin.newAdmin.phoneOptional')"
            type="tel"
            autocomplete="off"
          />

          <div class="mt-4">
            <label for="password" class="mb-1.5 block text-sm font-medium">
              {{ i18n.t('admin.newAdmin.passwordLabel') }}
            </label>
            <div class="flex flex-wrap items-start gap-2">
              <input
                [formField]="newAdminForm.password"
                id="password"
                [type]="passwordVisible() ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                class="min-w-0 flex-1 rounded-lg border bg-white px-3.5 py-2 font-mono text-sm shadow-card transition focus:outline-none focus:ring-2"
                [class]="
                  passwordError()
                    ? 'border-rose-600 focus:ring-rose-600/20'
                    : 'border-stone-300 focus:border-brand-600 focus:ring-brand-ring'
                "
                [attr.aria-invalid]="passwordError() !== null"
                [attr.aria-describedby]="
                  passwordError() ? 'password-err' : 'password-hint'
                "
              />
              <button
                type="button"
                [class]="secondaryButton"
                (click)="onGenerate()"
              >
                {{ i18n.t('admin.newAdmin.generate') }}
              </button>
              <button
                type="button"
                [class]="secondaryButton"
                [attr.aria-pressed]="passwordVisible()"
                (click)="toggleVisibility()"
              >
                {{
                  passwordVisible()
                    ? i18n.t('admin.newAdmin.hide')
                    : i18n.t('admin.newAdmin.show')
                }}
              </button>
              <button
                type="button"
                [class]="secondaryButton"
                (click)="copy(model().password)"
              >
                {{ copyLabel() }}
              </button>
            </div>
            @if (passwordError(); as msg) {
              <p
                id="password-err"
                class="mt-1.5 text-[13px] font-medium text-rose-600"
              >
                {{ msg }}
              </p>
            } @else {
              <p id="password-hint" class="mt-1.5 text-[13px] text-stone-500">
                {{ i18n.t('admin.newAdmin.passwordHint') }}
              </p>
            }
          </div>

          <button
            type="submit"
            [disabled]="newAdminForm().submitting()"
            class="btn-primary mt-6 w-auto"
          >
            {{
              newAdminForm().submitting()
                ? i18n.t('admin.newAdmin.submitting')
                : i18n.t('admin.newAdmin.submit')
            }}
          </button>
        </form>
      }
    </section>
  `,
})
export default class NewAdmin {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);

  protected readonly secondaryButton = SECONDARY_BUTTON;
  private readonly createdHeading =
    viewChild<ElementRef<HTMLElement>>('createdHeading');

  protected readonly model = signal(EMPTY_MODEL);
  protected readonly serverError = signal<string | null>(null);
  /** Konto utworzone w tej sesji formularza — hasła nie da się już odczytać z API, więc
   *  zostaje na ekranie do przekazania nowemu administratorowi. */
  protected readonly created = signal<{
    email: string;
    password: string;
  } | null>(null);
  protected readonly copied = signal(false);
  /** Wpisane ręcznie hasło startuje zakryte; generator je odsłania (patrz komentarz klasy). */
  protected readonly passwordVisible = signal(false);

  protected readonly copyLabel = computed(() =>
    this.copied()
      ? this.i18n.t('admin.newAdmin.copied')
      : this.i18n.t('admin.newAdmin.copy'),
  );

  constructor() {
    // sukces niszczy formularz razem z fokusowanym przyciskiem — fokus idzie na komunikat
    effect(() => this.createdHeading()?.nativeElement.focus());
  }

  /**
   * Adresy odrzucone przez API jako zajęte (409). Trzymane jako lista, nie jako pojedynczy
   * komunikat: konflikt jest własnością konkretnego adresu, więc po poprawce znika sam,
   * a po powrocie do poprzedniego adresu wraca — bez odpytywania serwera drugi raz.
   */
  private readonly takenEmails = signal<readonly string[]>([]);

  protected readonly newAdminForm = form(this.model, (p) => {
    apply(p.firstName, personNameSchema('firstName'));
    apply(p.lastName, personNameSchema('lastName'));
    apply(p.email, emailSchema);
    apply(p.password, passwordSchema);
    // 409 pokazujemy przy polu e-mail, a nie jako błąd ogólny nad formularzem: to jedyne
    // pole, które użytkownik może w reakcji poprawić
    validate(p.email, ({ value }) =>
      this.takenEmails().includes(normalizeEmail(value()))
        ? { kind: 'emailTaken', message: translate('validation.email.taken') }
        : null,
    );
    pattern(p.phone, PHONE, {
      message: () => translate('validation.phone.invalid'),
    });
  });

  /** Komunikat pod polem hasła — pole ma własną obudowę (generator + kopiowanie),
   *  więc nie korzysta z `app-form-field`. */
  protected readonly passwordError = computed(() => {
    const field = this.newAdminForm.password();
    return field.touched() && field.invalid()
      ? (field.errors()[0]?.message ?? null)
      : null;
  });

  protected onGenerate(): void {
    this.model.update((m) => ({ ...m, password: generatePassword() }));
    this.passwordVisible.set(true);
    this.copied.set(false);
  }

  protected toggleVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  /** Kopiowanie „na miękko": bez Clipboard API (stary przeglądarkowy kontekst, brak
   *  uprawnienia) hasło i tak jest na ekranie i da się je zaznaczyć. */
  protected async copy(password: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(password);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  protected addAnother(): void {
    this.model.set(EMPTY_MODEL);
    this.created.set(null);
    this.passwordVisible.set(false);
    this.copied.set(false);
    this.serverError.set(null);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submitAuthForm(this.newAdminForm, this.serverError, async () => {
      const m = this.model();
      // trim jak przy e-mailu: backendowy `IsNotBlank` przepuszcza „ Jan ", a spacja na
      // brzegu imienia zostałaby w bazie i wyszła w każdym miejscu, które je pokazuje
      const email = m.email.trim();
      const phone = m.phone.trim();
      try {
        await firstValueFrom(
          this.api.post<{ id: string }>('/admin/users', {
            email,
            firstName: m.firstName.trim(),
            lastName: m.lastName.trim(),
            password: m.password,
            ...(phone ? { phone } : {}),
          }),
        );
      } catch (err) {
        if (isApiStatus(err, 409)) {
          // walidacja pola przejmuje komunikat — nie ma być drugiego, ogólnego nad formularzem
          this.takenEmails.update((taken) => [...taken, normalizeEmail(email)]);
          return;
        }
        throw err;
      }
      this.created.set({ email, password: m.password });
      this.copied.set(false);
    });
  }
}
