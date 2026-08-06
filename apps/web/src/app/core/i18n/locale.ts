import { signal } from '@angular/core';

export type Locale = 'pl' | 'en';

export const LOCALES: readonly Locale[] = ['pl', 'en'];

/** Domyślny język — polski, dopóki użytkownik świadomie nie przełączy (#57). Nie zgadujemy
 *  z `navigator.language`: aplikacja obsługuje wyłącznie polskie firmy, a wykrywanie z
 *  przeglądarki uzależniałoby wynik testów od locale maszyny CI. */
export const DEFAULT_LOCALE: Locale = 'pl';

/** Tag BCP 47 dla `Intl` — wybór języka UI decyduje o formacie dat, liczb i cen.
 *  en-GB, nie en-US: format 24-godzinny i dzień przed miesiącem są bliższe temu,
 *  czego oczekuje użytkownik patrzący na grafik polskiej firmy. */
const TAGS: Record<Locale, string> = { pl: 'pl-PL', en: 'en-GB' };

const LOCALE_KEY = 'bookit.locale';

function isLocale(value: unknown): value is Locale {
  return value === 'pl' || value === 'en';
}

function readStored(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/**
 * Sygnał na poziomie modułu, nie w serwisie — celowo. Z języka korzystają czyste funkcje wołane
 * spoza DI: `apiErrorMessage` (53 miejsca), `formatDateTime`, `depositError`, `PricePlnPipe`.
 * Gdyby locale żyło tylko w serwisie, każda z nich musiałaby dostać go argumentem albo przez
 * `inject()`, a aplikacja jest zoneless — to odczyt sygnału w wyrażeniu szablonu decyduje
 * o ponownym renderze. Sygnał modułowy daje jedno i drugie za darmo.
 */
const localeSignal = signal<Locale>(readStored());

/** Aktualny język UI. Odczyt w szablonie/`computed` = automatyczne odświeżenie po zmianie. */
export const currentLocale = localeSignal.asReadonly();

/** Tag do `Intl.*` dla aktualnego języka. Reaktywny tak samo jak `currentLocale`. */
export function localeTag(): string {
  return TAGS[localeSignal()];
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
  localeSignal.set(locale);
  // WCAG 3.1.1: czytnik ekranu dobiera fonetykę po atrybucie lang, a index.html ma na sztywno
  // lang="pl" jako wartość startową
  document.documentElement.lang = locale;
}

/** Reset do stanu po pierwszym wejściu — dla testów. Sygnał jest modułowy, więc bez tego
 *  spek ustawiający EN zatruwałby kolejne pliki w tym samym workerze vitest. */
export function resetLocale(): void {
  localStorage.removeItem(LOCALE_KEY);
  localeSignal.set(DEFAULT_LOCALE);
  document.documentElement.lang = DEFAULT_LOCALE;
}
