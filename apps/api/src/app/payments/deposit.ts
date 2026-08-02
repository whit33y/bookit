import { DepositType } from '@prisma/client';

/**
 * Reguły zaliczki per usługa — czyste, bez PrismaService i bez Nesta, wzorem
 * cancellation-policy.ts. Trzy miejsca liczą z nich to samo i nie mogą się rozjechać:
 * ServicesService waliduje CRUD usług (#50), #51 przelicza kwotę na PaymentIntent,
 * #53 pokazuje ją klientowi przed potwierdzeniem rezerwacji. Te same niezmienniki
 * dubluje CHECK w migracji — tu dla czytelnego 400, tam jako ostatnia linia obrony.
 */

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
 * Kwota zaliczki w groszach albo null, gdy usługa jej nie ma. Zaokrąglenie procentu
 * siedzi wyłącznie tutaj, żeby kwota pokazana klientowi (#53) i kwota PaymentIntenta (#51)
 * nie różniły się o grosz — przy różnicy Stripe pobrałby inną sumę, niż widział klient.
 */
export const depositAmountCents = ({
  depositType,
  depositValue,
  priceCents,
}: DepositFields): number | null => {
  if (depositType === null || depositValue === null) {
    return null;
  }
  if (depositType === DepositType.FIXED) {
    return depositValue;
  }
  return Math.round((priceCents * depositValue) / 100);
};

/**
 * Polski komunikat błędu albo null, gdy zaliczka jest poprawna. Zwracamy komunikat zamiast
 * rzucać BadRequestException, bo z tej samej funkcji korzysta test danych demo — helper
 * zostaje niezależny od Nesta, a mapowanie na 400 robi serwis.
 */
export const depositError = (fields: DepositFields): string | null => {
  const { depositType, depositValue, priceCents } = fields;

  if (depositType === null && depositValue === null) {
    return null;
  }
  if (depositType === null || depositValue === null) {
    return 'Typ i wartość zaliczki ustawia się razem';
  }

  if (depositType === DepositType.PERCENT) {
    if (depositValue < MIN_DEPOSIT_PERCENT || depositValue > MAX_DEPOSIT_PERCENT) {
      return `Zaliczka procentowa to ${MIN_DEPOSIT_PERCENT}–${MAX_DEPOSIT_PERCENT}% ceny`;
    }
    // procent z groszowej ceny może się zaokrąglić do zera — takiej płatności nie da się
    // pobrać, a CHECK na Payment.amountCents odrzuciłby ją dopiero przy rezerwacji
    if ((depositAmountCents(fields) ?? 0) < 1) {
      return 'Zaliczka po przeliczeniu wychodzi 0 gr — podnieś procent albo cenę usługi';
    }
    return null;
  }

  if (depositValue < 1) {
    return 'Kwota zaliczki musi być większa od zera';
  }
  // cena 0 gr wpada tutaj: żadna dodatnia zaliczka nie jest od niej mniejsza ani równa
  if (depositValue > priceCents) {
    return 'Zaliczka nie może być wyższa niż cena usługi';
  }
  return null;
};
