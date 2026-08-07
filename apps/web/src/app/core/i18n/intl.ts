import { localeTag } from './locale';

/**
 * Instancje `Intl.*` dla aktualnego języka, z cache. Tworzenie formattera jest kosztowne
 * (ładowanie danych CLDR), a te same opcje wracają setki razy przy każdym renderze listy —
 * poprzednio kod trzymał je jako stałe modułowe, co przestało wystarczać, gdy locale zmienia
 * się w trakcie życia aplikacji (#57).
 *
 * Każdy getter czyta `localeTag()`, więc odczyt w wyrażeniu szablonu jest reaktywny:
 * po przełączeniu języka Angular przerenderowuje widok, a tu wraca formatter dla nowego locale.
 */

function cached<T>(
  cache: Map<string, T>,
  options: object | undefined,
  create: (tag: string) => T,
): T {
  const tag = localeTag();
  const key = `${tag}|${JSON.stringify(options ?? {})}`;
  let value = cache.get(key);
  if (value === undefined) {
    value = create(tag);
    cache.set(key, value);
  }
  return value;
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();
const pluralCache = new Map<string, Intl.PluralRules>();
const collatorCache = new Map<string, Intl.Collator>();

export function dateTimeFormat(
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cached(
    dateTimeCache,
    options,
    (tag) => new Intl.DateTimeFormat(tag, options),
  );
}

export function numberFormat(
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return cached(
    numberCache,
    options,
    (tag) => new Intl.NumberFormat(tag, options),
  );
}

export function relativeTimeFormat(
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cached(
    relativeCache,
    options,
    (tag) => new Intl.RelativeTimeFormat(tag, options),
  );
}

export function pluralRules(options?: Intl.PluralRulesOptions): Intl.PluralRules {
  return cached(pluralCache, options, (tag) => new Intl.PluralRules(tag, options));
}

/** Kolacja do sortowania nazw — „Łukasz" po polsku idzie po „Lech", a nie na koniec alfabetu. */
export function collator(options?: Intl.CollatorOptions): Intl.Collator {
  return cached(collatorCache, options, (tag) => new Intl.Collator(tag, options));
}
