import { Service } from '@angular/core';
import { LOCALES, currentLocale, setLocale, type Locale } from './locale';
import { translate, translatePlural } from './translate';

/**
 * Dostęp do tłumaczeń z szablonów: `protected readonly i18n = inject(I18nStore)`, a potem
 * `{{ i18n.t('nav.logout') }}`.
 *
 * Cienka warstwa nad funkcjami z `translate.ts` — stan (sygnał locale) mieszka na poziomie
 * modułu, bo korzystają z niego też funkcje spoza DI. Serwis istnieje wyłącznie po to, żeby
 * szablon miał się czego uchwycić.
 *
 * `t` i `plural` są polami wskazującymi na wolne funkcje, nie metodami — nie ma `this`,
 * więc referencję można bezpiecznie przekazać dalej (np. jako `message` w Signal Forms).
 */
@Service()
export class I18nStore {
  readonly locale = currentLocale;
  readonly locales = LOCALES;
  readonly t = translate;
  readonly plural = translatePlural;

  setLocale(locale: Locale): void {
    setLocale(locale);
  }
}
