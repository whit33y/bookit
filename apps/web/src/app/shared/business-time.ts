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

const dateFormat = new Intl.DateTimeFormat('pl-PL', {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: 'short',
});

/** Sama godzina w strefie firmy, np. „09:30". */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** Pełna data i godzina w strefie firmy, np. „poniedziałek, 3 sierpnia 2026, 09:30". */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** Sama data w strefie firmy, np. „3.08.2026" — do komórek tabel, gdzie formatDateTime
 *  („poniedziałek, 3 sierpnia 2026, 09:30") rozpycha kolumnę. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Powyżej tygodnia „7 dni temu" mówi mniej niż data — wtedy oddajemy zwykłą datę. */
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

/**
 * Czas względem teraz: „2 minuty temu", „wczoraj", a powyżej tygodnia data („3.08.2026").
 * Na liście powiadomień (#54) liczy się „jak dawno", nie dokładny znacznik — pełny termin
 * wizyty jest w treści powiadomienia. Przyszłość obsługujemy, bo zegar klienta może
 * wyprzedzać serwer o kilka sekund; Intl daje wtedy „za chwilę", a nie ujemne minuty.
 */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  if (absMs >= RELATIVE_LIMIT_MS) {
    return formatDate(iso);
  }
  // trunc, nie round: „1 godzinę temu" dla 90 minut to konwencja czasu względnego, a round
  // dodatkowo zaokrągla asymetrycznie dla wartości ujemnych (−1,5 → −1, ale 1,5 → 2)
  if (absMs < HOUR_MS) {
    return relativeFormat.format(Math.trunc(diffMs / MINUTE_MS), 'minute');
  }
  if (absMs < DAY_MS) {
    return relativeFormat.format(Math.trunc(diffMs / HOUR_MS), 'hour');
  }
  return relativeFormat.format(Math.trunc(diffMs / DAY_MS), 'day');
}

/** Dzisiejsza data w strefie firmy jako YYYY-MM-DD (en-CA daje dokładnie ten format). */
export function todayInBusinessTz(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(now);
}
