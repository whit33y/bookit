import { Component, inject } from '@angular/core';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { Locale } from '../../core/i18n/locale';

/** Skrót widoczny na przycisku. Nazwy języków zostają w ich własnym języku — „Polski" po
 *  angielsku brzmiałoby „Polish", ale to przełącznik, a nie tłumaczenie nazw. */
const SHORT: Record<Locale, string> = { pl: 'PL', en: 'EN' };

/**
 * Przełącznik języka PL/EN w nawigacji (#57). Dwie opcje nie potrzebują popovera ani
 * `<select>` — grupa dwóch przycisków ze stanem `aria-pressed` jest krótsza w obsłudze
 * klawiaturą i czytelniejsza dla czytnika ekranu.
 *
 * Dlaczego nie `aria-label` na przyciskach: dostępna nazwa musi zawierać widoczny tekst
 * (WCAG 2.5.3), a „Polski" nie zawiera „PL". Znaczenie niesie więc etykieta grupy — celowo
 * dwujęzyczna, bo czyta ją też ktoś, kto właśnie nie rozumie aktualnego języka UI.
 * `lang` na przyciskach pilnuje, żeby syntezator nie przeczytał „EN" polską fonetyką.
 *
 * Komponent stoi poza gałęzią `@if (auth.isLoggedIn())` w app.html — język trzeba móc zmienić
 * przed zalogowaniem, na ekranie logowania włącznie.
 */
@Component({
  selector: 'app-language-switcher',
  template: `
    <div
      role="group"
      [attr.aria-label]="i18n.t('language.groupLabel')"
      class="inline-flex overflow-hidden rounded-lg border border-stone-300"
    >
      @for (locale of i18n.locales; track locale) {
        <button
          type="button"
          [lang]="locale"
          [attr.aria-pressed]="i18n.locale() === locale"
          (click)="i18n.setLocale(locale)"
          class="px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
          [class]="
            i18n.locale() === locale
              ? 'bg-brand-700 text-white'
              : 'bg-white text-stone-600 hover:bg-stone-50'
          "
        >
          {{ short[locale] }}
        </button>
      }
    </div>
  `,
})
export default class LanguageSwitcher {
  protected readonly i18n = inject(I18nStore);
  protected readonly short = SHORT;
}
