import { Pipe, PipeTransform } from '@angular/core';

/** Grosze → sformatowana cena w zł (pl-PL). Pełne złote bez groszy (7000 → „70 zł"),
 *  niepełne z groszami (4550 → „45,50 zł"). Intl jest natywne — bez rejestracji locale. */
@Pipe({ name: 'pricePln' })
export class PricePlnPipe implements PipeTransform {
  transform(priceCents: number): string {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: priceCents % 100 ? 2 : 0,
    }).format(priceCents / 100);
  }
}
