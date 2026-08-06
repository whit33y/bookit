import { Pipe, PipeTransform } from '@angular/core';
import { numberFormat } from '../core/i18n/intl';

/**
 * Grosze → sformatowana cena. Pełne złote bez groszy (7000 → „70 zł" / „PLN 70"),
 * niepełne z groszami (4550 → „45,50 zł" / „PLN 45.50").
 *
 * Waluta zostaje PLN niezależnie od języka — firmy są polskie i tyle pobiera Stripe. Zmienia się
 * tylko locale formatowania: separator dziesiętny i pozycja symbolu (#57).
 *
 * `pure: false`, bo czysty pipe cache'uje wynik po argumencie — po przełączeniu języka
 * `priceCents` się nie zmienia, więc czysta wersja oddałaby stary format. Koszt jest pomijalny:
 * to odczyt z `Map` plus `Intl.format`, a instancje formatterów są cache'owane w `core/i18n/intl`.
 */
@Pipe({ name: 'pricePln', pure: false })
export class PricePlnPipe implements PipeTransform {
  transform(priceCents: number): string {
    return numberFormat({
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: priceCents % 100 ? 2 : 0,
    }).format(priceCents / 100);
  }
}
