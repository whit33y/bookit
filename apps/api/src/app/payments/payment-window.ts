import { addMinutes } from '../availability/business-time';

/**
 * Okno na opłacenie zaliczki — czyste, bez PrismaService i bez Nesta, wzorem deposit.ts obok
 * i cancellation-policy.ts w bookings. Trzy miejsca liczą z niego to samo i nie mogą się
 * rozjechać: BookingsService podaje klientowi termin ważności przy rezerwacji, cron wygaszania
 * wybiera po nim płatności do anulowania, a #53 pokazuje z niego odliczanie w kreatorze.
 */

/**
 * Waluta zaliczek. Zgodna z `@default("pln")` na Payment.currency; Stripe rozlicza PLN
 * w groszach, więc `amountCents` idzie do API bez żadnego przeliczania.
 */
export const PAYMENT_CURRENCY = 'pln';

/**
 * Ile klient ma na opłacenie, licząc od utworzenia rezerwacji. Kompromis: krócej frustrowałoby
 * kogoś, kto akurat szuka karty, dłużej trzymałoby zajęty slot za rezerwację, której nikt
 * nie zamierza opłacić.
 */
export const PAYMENT_TIMEOUT_MIN = 15;

/**
 * Ostatni moment na opłacenie. Liczony z `Payment.createdAt`, a nie z osobnej kolumny
 * `expiresAt` — dokładnie po to #50 założyło `@@index([status, createdAt])` na Payment.
 */
export const paymentDeadline = (createdAt: Date): Date =>
  addMinutes(createdAt, PAYMENT_TIMEOUT_MIN);

/**
 * Najpóźniejsze `createdAt`, które o czasie `now` jeszcze się nie przeterminowało — granica
 * zapytania crona (`createdAt < expiryCutoff(now)`). Odwrotność `paymentDeadline`, wyliczana
 * raz na przebieg, żeby cron nie mapował deadline'u per wiersz.
 */
export const expiryCutoff = (now: Date): Date =>
  addMinutes(now, -PAYMENT_TIMEOUT_MIN);

/**
 * Czy płatność utworzona o `createdAt` przeterminowała się do chwili `now`. Nierówność ostra,
 * tak jak w cancellation-policy.ts: płatność w dokładnie ostatniej sekundzie okna jeszcze żyje.
 */
export const isPaymentExpired = (createdAt: Date, now: Date): boolean =>
  paymentDeadline(createdAt) < now;
