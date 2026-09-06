import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHANGE_PASSWORD_PATH } from '../core/auth/auth-store';
import { I18nStore } from '../core/i18n/i18n-store';
import PersonalDetails from './personal-details';
import ProfilePhoto from './profile-photo';

/**
 * Ustawienia konta (#162, CONTEXT.md → „Ustawienia konta") — miejsce, w którym zalogowany
 * zarządza sobą. Trasa `/account` jest dla każdej roli: hasło i dane osobowe ma każde konto,
 * a właściciel ma ten ekran obok ustawień firmy.
 *
 * Układ wzorowany na ustawieniach firmy (`business/settings/settings.ts`), ale **bez jednego
 * wspólnego „Zapisz"**: każda sekcja ma własne żądanie i własny skutek, więc jeden przycisk
 * kłamałby o tym, co się stanie po kliknięciu.
 *
 * Hasło jest tu tylko wejściem na istniejący `/change-password` (do #162 nie prowadził tam
 * żaden link) — drugiej kopii formularza nie stawiamy, bo rozjechałaby się przy pierwszej
 * poprawce. „Zdjęcie profilowe" (#164) stoi między danymi osobowymi a hasłem; sekcja „Adres
 * e-mail" dojdzie osobnym zadaniem, w to samo miejsce.
 */
@Component({
  selector: 'app-account-settings',
  imports: [PersonalDetails, ProfilePhoto, RouterLink],
  template: `
    <div class="flex flex-1 items-center justify-center px-4 py-8">
      <section
        class="w-full max-w-2xl rounded-xl border border-stone-200 bg-white p-8 shadow-card"
      >
        <h1 class="text-2xl font-bold">{{ i18n.t('account.title') }}</h1>
        <p class="mt-1 text-sm text-stone-500">{{ i18n.t('account.subtitle') }}</p>

        <app-personal-details class="mt-8 block" />

        <app-profile-photo class="mt-10 block border-t border-stone-200 pt-8" />

        <section class="mt-10 border-t border-stone-200 pt-8">
          <h2 class="text-lg font-bold">{{ i18n.t('account.password.title') }}</h2>
          <p class="mt-1 text-sm text-stone-500">
            {{ i18n.t('account.password.subtitle') }}
          </p>
          <a
            [routerLink]="changePasswordPath"
            class="mt-4 inline-block rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {{ i18n.t('account.password.link') }}
          </a>
        </section>
      </section>
    </div>
  `,
})
export default class AccountSettings {
  protected readonly i18n = inject(I18nStore);
  /** Ta sama stała, z której korzystają guard i interceptor — jeden adres ekranu zmiany hasła. */
  protected readonly changePasswordPath = CHANGE_PASSWORD_PATH;
}
