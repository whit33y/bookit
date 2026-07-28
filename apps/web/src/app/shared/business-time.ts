/** Lustro BUSINESS_TIMEZONE z apps/api/src/app/availability/business-time.ts. Backend zwraca
 *  instanty UTC (sloty, wizyty), a użytkownik myśli godzinami firmy — formatujemy jawnie w jej
 *  strefie, żeby przeglądarka spoza PL nie pokazała innej godziny niż grafik. */
export const BUSINESS_TIMEZONE = 'Europe/Warsaw';

const timeFormat = new Intl.DateTimeFormat('pl-PL', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeFormat = new Intl.DateTimeFormat('pl-PL', {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: 'full',
  timeStyle: 'short',
});

/** Sama godzina w strefie firmy, np. „09:30". */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** Pełna data i godzina w strefie firmy, np. „poniedziałek, 3 sierpnia 2026, 09:30". */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** Dzisiejsza data w strefie firmy jako YYYY-MM-DD (en-CA daje dokładnie ten format). */
export function todayInBusinessTz(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(now);
}
