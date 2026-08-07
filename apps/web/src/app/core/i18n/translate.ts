import { en } from './en';
import { pluralRules } from './intl';
import { currentLocale, type Locale } from './locale';
import { pl, type Dictionary, type TranslationKey } from './pl';

const DICTIONARIES: Record<Locale, Dictionary> = { pl, en };

export type TranslationParams = Record<string, string | number>;

/**
 * Baza wpisu liczby mnogiej — wyprowadzona z unii kluczy, więc `plural('search.results', n)`
 * kompiluje się tylko wtedy, gdy w słowniku faktycznie istnieje `search.results.other`.
 */
type PluralBase<K> = K extends `${infer Base}.other` ? Base : never;
export type PluralKey = PluralBase<TranslationKey>;

/** Odczyt „na miękko": klucz złożony w runtime (`${base}.${kategoria}`) może nie istnieć. */
function lookup(dict: Dictionary, key: string): string | undefined {
  return (dict as Record<string, string | undefined>)[key];
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Tłumaczenie dla aktualnego języka. Czyta sygnał locale, więc wywołanie w wyrażeniu szablonu
 * jest reaktywne — po przełączeniu języka Angular przerenderowuje widok (aplikacja jest
 * zoneless, odczyt sygnału to jedyny niezawodny wyzwalacz).
 *
 * Pusty lub brakujący wpis spada na polski. Typy pilnują kompletu słowników, więc to zabezpieczenie
 * na wypadek obejścia typu — lepiej pokazać polski tekst niż surowy klucz.
 */
export function translate(
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const dict = DICTIONARIES[currentLocale()];
  return interpolate(lookup(dict, key) || pl[key], params);
}

/**
 * Tłumaczenie z odmianą przez liczbę. Kategorię wybiera `Intl.PluralRules` dla aktualnego
 * locale — polski dostaje one/few/many (z pułapką nastek 12–14 obsłużoną przez CLDR),
 * angielski one/other. To zastąpiło ręczne `pluralPl` i jego duplikat w `search.ts`.
 *
 * `{count}` jest dostępny w szablonie bez podawania go w `params`.
 */
export function translatePlural(
  base: PluralKey,
  count: number,
  params?: TranslationParams,
): string {
  const dict = DICTIONARIES[currentLocale()];
  const category = pluralRules().select(count);
  const template =
    lookup(dict, `${base}.${category}`) ||
    lookup(dict, `${base}.other`) ||
    lookup(pl, `${base}.other`) ||
    `${base}.other`;
  return interpolate(template, { count, ...params });
}
