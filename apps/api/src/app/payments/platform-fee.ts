/**
 * Prowizja platformy od zaliczki (#52) — czysta, bez PrismaService i bez Nesta, wzorem
 * deposit.ts i payment-window.ts obok. Stawka jest globalna i siedzi w `PLATFORM_FEE_PERCENT`;
 * PaymentsService czyta ją przez ConfigService i wystawia jako `platformFeeFor`, żeby
 * BookingsService nie musiał znać ani wartości, ani nazwy zmiennej.
 *
 * To **zapis do rozliczeń**, a nie `application_fee_amount` ze Stripe'a: tamto wymaga Connect
 * i konta firmy po stronie Stripe'a, czego model Business nie przewiduje. Wyliczoną kwotę
 * przypinamy do wiersza Payment przy jego tworzeniu, więc późniejsza zmiana stawki nie rusza
 * rozliczeń płatności, które już się odbyły.
 */

/** Stawka użyta, gdy `PLATFORM_FEE_PERCENT` nie jest ustawione — tyle bierze platforma domyślnie. */
export const DEFAULT_PLATFORM_FEE_PERCENT = 10;

export const MIN_PLATFORM_FEE_PERCENT = 0;
export const MAX_PLATFORM_FEE_PERCENT = 100;

/**
 * Prowizja w groszach. `Math.round` jak w `depositAmountCents` — grosze są najmniejszą
 * jednostką, którą Stripe rozlicza, więc ułamek trzeba domknąć w jedną, przewidywalną stronę.
 *
 * Wynik przycinamy do `amountCents`: prowizja większa od samej zaliczki znaczyłaby, że platforma
 * dopłaca do przelewu. Przy poprawnej stawce (0–100%) zaokrąglenie i tak nigdy tego progu nie
 * przekroczy — clamp jest tu na wypadek, gdyby ktoś obszedł walidację i wstawił stawkę wprost.
 */
export const platformFeeCents = (
  amountCents: number,
  percent: number,
): number =>
  Math.min(Math.round((amountCents * percent) / 100), Math.max(amountCents, 0));

/**
 * Stawka z konfiguracji. Brak wartości to normalny przypadek (świeży `.env` bez płatności),
 * więc schodzimy na domyślną. Wartość **ustawiona, ale niepoprawna** to już literówka
 * w konfiguracji i ma być głośna: prowizja liczona ze złej stawki rozjeżdża rozliczenia po
 * cichu, a naprawa wymaga migracji danych. To inny przypadek niż brak kluczy Stripe, który
 * świadomie nie blokuje startu — tam brak konfiguracji ma zdefiniowane znaczenie („płatności
 * wyłączone"), tu literówka nie ma żadnego.
 */
export const parsePlatformFeePercent = (raw: string | undefined): number => {
  // pusty string traktujemy jak brak — tak wygląda świeży .env skopiowany z .env.example
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PLATFORM_FEE_PERCENT;
  }
  const percent = Number(raw);
  if (
    !Number.isFinite(percent) ||
    percent < MIN_PLATFORM_FEE_PERCENT ||
    percent > MAX_PLATFORM_FEE_PERCENT
  ) {
    throw new Error(
      `PLATFORM_FEE_PERCENT musi być liczbą z zakresu ${MIN_PLATFORM_FEE_PERCENT}–${MAX_PLATFORM_FEE_PERCENT}, jest: ${raw}`,
    );
  }
  return percent;
};
