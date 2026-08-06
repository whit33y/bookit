import { BUSINESS_TIMEZONE, utcToLocalDate } from '../availability/business-time';

// Formatowanie na potrzeby treści maili: instanty z bazy (UTC) na ścianę zegara firmy
// i grosze na złotówki. Na Intl, jak business-time.ts — pełne ICU jest w runtime, więc
// polskie nazwy dni i miesięcy dostajemy bez dodatkowej biblioteki.
//
// To formatowanie prezentacyjne, nie liczenie czasu: konwersje instant ↔ czas lokalny
// (grafiki, sloty, doby) zostają w business-time.ts, tutaj tylko napisy dla człowieka.

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('pl-PL', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const priceFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
});

/** „czwartek, 14 stycznia 2026, 09:00–10:00" — cały termin wizyty w jednej linii. */
export const formatDateTimeRange = (startsAt: Date, endsAt: Date): string =>
  `${dateFormatter.format(startsAt)}, ${timeFormatter.format(startsAt)}–${timeFormatter.format(endsAt)}`;

/** Cena informacyjna z groszy: 12000 → „12 000,00 zł" (Intl wstawia NBSP przed „zł"). */
export const formatPrice = (priceCents: number): string =>
  priceFormatter.format(priceCents / 100);

/** Czas trwania usługi — minuty tak, jak trzyma je Service.durationMin. */
export const formatDuration = (durationMin: number): string => `${durationMin} min`;

/**
 * „2026-01-14" — doba lokalna firmy, w której wypada ten instant. Do linków deep-link
 * powiadomień in-app (#54), bo kalendarz panelu adresuje dni przez `?date=YYYY-MM-DD`.
 * Nie `toISOString().slice(0, 10)`: dla wizyty o 22:30 czasu polskiego UTC pokazuje już
 * następny dzień i kalendarz otwierałby się na pustym dniu.
 */
export const formatDateIso = (instant: Date): string => {
  const { year, month, day } = utcToLocalDate(instant, BUSINESS_TIMEZONE);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
