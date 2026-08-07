/**
 * Lustro reguł zaliczki z `apps/api/src/app/payments/deposit.ts` (#50). Repo nie ma wspólnej
 * libki DTO — każdy kontrakt jest po stronie web powielony (patrz core/api-client.ts) — więc
 * te same reguły żyją w dwóch plikach i zmienia się je razem. Rozjazd wychodzi w testach:
 * deposit.spec.ts po obu stronach sprawdza te same przypadki.
 *
 * Po co lustro zamiast polegania na 400 z serwera: bez niego właściciel dowiaduje się o złej
 * zaliczce dopiero po wysłaniu formularza, jednym komunikatem nad całą formą, bez wskazania pola.
 */

import { translate } from '../core/i18n/translate';

/** FIXED → depositValue w groszach, PERCENT → w procentach ceny (1–100). */
export type DepositType = 'FIXED' | 'PERCENT';

export interface DepositFields {
  /** null = usługa bez zaliczki, cała płatność na miejscu */
  depositType: DepositType | null;
  /** FIXED → grosze, PERCENT → procent ceny */
  depositValue: number | null;
  priceCents: number;
}

export const MIN_DEPOSIT_PERCENT = 1;
export const MAX_DEPOSIT_PERCENT = 100;

/**
 * Kwota zaliczki w groszach albo null, gdy usługa jej nie ma. Zaokrąglenie musi być identyczne
 * jak na backendzie — inaczej kwota pokazana w panelu różniłaby się od tej, którą pobierze Stripe.
 */
export const depositAmountCents = ({
  depositType,
  depositValue,
  priceCents,
}: DepositFields): number | null => {
  if (depositType === null || depositValue === null) {
    return null;
  }
  if (depositType === 'FIXED') {
    return depositValue;
  }
  return Math.round((priceCents * depositValue) / 100);
};

/** Komunikat błędu w języku UI albo null, gdy zaliczka jest poprawna. Polskie brzmienie to
 *  dokładnie te same stringi co w backendowym `depositError` (patrz `pl.ts`), żeby walidacja
 *  frontowa i 400 z serwera mówiły to samo. */
export const depositError = (fields: DepositFields): string | null => {
  const { depositType, depositValue, priceCents } = fields;

  if (depositType === null && depositValue === null) {
    return null;
  }
  if (depositType === null || depositValue === null) {
    return translate('deposit.error.typeAndValueTogether');
  }

  if (depositType === 'PERCENT') {
    if (
      depositValue < MIN_DEPOSIT_PERCENT ||
      depositValue > MAX_DEPOSIT_PERCENT
    ) {
      return translate('deposit.error.percentRange', {
        min: MIN_DEPOSIT_PERCENT,
        max: MAX_DEPOSIT_PERCENT,
      });
    }
    // procent z groszowej ceny może się zaokrąglić do zera — takiej płatności Stripe nie pobierze
    if ((depositAmountCents(fields) ?? 0) < 1) {
      return translate('deposit.error.roundsToZero');
    }
    return null;
  }

  if (depositValue < 1) {
    return translate('deposit.error.mustBePositive');
  }
  // cena 0 gr wpada tutaj: żadna dodatnia zaliczka nie jest od niej mniejsza ani równa
  if (depositValue > priceCents) {
    return translate('deposit.error.exceedsPrice');
  }
  return null;
};
