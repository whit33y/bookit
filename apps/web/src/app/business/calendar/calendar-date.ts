import { dateTimeFormat } from '../../core/i18n/intl';
import { BUSINESS_TIMEZONE } from '../../shared/business-time';

/** Okno siatki kalendarza — poza tymi godzinami wizyty są przycinane do brzegu (SDD #32).
 *  Krok co 15 min zgodny z SLOT_STEP_MIN w apps/api/.../availability/business-time.ts. */
export const CALENDAR_WINDOW_START_MIN = 7 * 60;
export const CALENDAR_WINDOW_END_MIN = 21 * 60;
export const CALENDAR_SLOT_MIN = 15;
export const CALENDAR_TOTAL_SLOTS =
  (CALENDAR_WINDOW_END_MIN - CALENDAR_WINDOW_START_MIN) / CALENDAR_SLOT_MIN;
export const CALENDAR_HOUR_MARKS = Array.from(
  { length: (CALENDAR_WINDOW_END_MIN - CALENDAR_WINDOW_START_MIN) / 60 },
  (_, i) => CALENDAR_WINDOW_START_MIN / 60 + i,
);

export interface GridPlacement {
  rowStart: number;
  rowEnd: number;
}

/** Parsuje „YYYY-MM-DD" na składowe liczbowe — daty kalendarzowe (nie instanty), więc zawsze
 *  przez Date.UTC, nigdy przez `new Date(str)` lokalne (zależne od strefy przeglądarki). */
function parseIsoDate(dateIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateIso.split('-').map(Number);
  return { y, m, d };
}

function toIsoDate(utcMs: number): string {
  const date = new Date(utcMs);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Czy „YYYY-MM-DD" jest istniejącą datą kalendarzową. Sam kształt nie wystarcza: `?date=2026-13-99`
 * z adresu przeszłoby regexa i rozjechało cały kalendarz (Date.UTC przewinęłoby to na inny rok).
 * Round-trip przez Date.UTC ujawnia przewinięcie — ten sam test co parseLocalDate w apps/api.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseIsoDate(value);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return (
    utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d
  );
}

/** Dodaje (lub odejmuje, dla ujemnych) dni do daty kalendarzowej. */
export function addDays(dateIso: string, days: number): string {
  const { y, m, d } = parseIsoDate(dateIso);
  return toIsoDate(Date.UTC(y, m - 1, d + days));
}

/** Poniedziałek tygodnia zawierającego podaną datę. getUTCDay() zwraca 0=niedziela..6=sobota;
 *  (day+6)%7 daje liczbę dni od poniedziałku (poniedziałek→0, niedziela→6). */
export function startOfWeekMonday(dateIso: string): string {
  const { y, m, d } = parseIsoDate(dateIso);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const offsetFromMonday = (day + 6) % 7;
  return addDays(dateIso, -offsetFromMonday);
}

/** 7 kolejnych dat tygodnia (poniedziałek..niedziela) zawierającego `anchorIso`. */
export function weekDays(anchorIso: string): string[] {
  const start = startOfWeekMonday(anchorIso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type CalendarViewMode = 'day' | 'week';

/** Zakres from/to (obie daty lokalne firmy) do GET /businesses/mine/bookings dla danego widoku. */
export function rangeForView(
  mode: CalendarViewMode,
  anchorIso: string,
): { from: string; to: string } {
  if (mode === 'day') {
    return { from: anchorIso, to: anchorIso };
  }
  const from = startOfWeekMonday(anchorIso);
  return { from, to: addDays(from, 6) };
}

/** Celowo stały `en-GB` z `hourCycle: 'h23'` — to nie jest tekst dla użytkownika, tylko parser
 *  „HH:MM" na minuty od północy. Locale UI nie może tu nic zmienić (#57). */
const wallTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Minuty od północy czasu ściennego firmy (Europe/Warsaw) dla instantu ISO, np. „09:30" → 570. */
export function minutesSinceMidnight(iso: string): number {
  const [h, m] = wallTimeFormat.format(new Date(iso)).split(':').map(Number);
  return h * 60 + m;
}

function clampToWindow(min: number): number {
  return Math.min(Math.max(min, CALENDAR_WINDOW_START_MIN), CALENDAR_WINDOW_END_MIN);
}

/** Wiersz 1 siatki to nagłówek, potem CALENDAR_TOTAL_SLOTS wierszy co 15 min od 07:00 do 21:00.
 *  Czas spoza okna jest przycinany do brzegów — to podgląd, nie planer konfliktów, więc
 *  nakładające się kafelki nie są rozkładane obok siebie (poza zakresem #32). */
export function bookingGridRow(startsAtIso: string, endsAtIso: string): GridPlacement {
  const rawStartMin = minutesSinceMidnight(startsAtIso);
  const rawEndMin = minutesSinceMidnight(endsAtIso);
  const startMin = clampToWindow(rawStartMin);
  // rezerwacja przechodząca przez północ — koniec „mniejszy" niż początek w tej samej dobie.
  // Porównanie musi iść po surowym starcie, nie po `startMin` przyciętym do okna — inaczej
  // rezerwacja w całości PRZED oknem (np. 05:00 przy oknie od 07:00) też wygląda na „koniec
  // mniejszy niż początek" i dostaje koniec przycięty do 21:00 zamiast do 07:00.
  const endMin = clampToWindow(
    rawEndMin <= rawStartMin ? CALENDAR_WINDOW_END_MIN : rawEndMin,
  );
  const rowStart =
    2 + Math.floor((startMin - CALENDAR_WINDOW_START_MIN) / CALENDAR_SLOT_MIN);
  const span = Math.max(1, Math.round((endMin - startMin) / CALENDAR_SLOT_MIN));
  return { rowStart, rowEnd: rowStart + span };
}

/** Skrócony dzień tygodnia + data w języku UI, np. „pon., 3 sie" / „Mon, 3 Aug" — data
 *  traktowana jako kalendarzowa (UTC), nie instant, więc formatujemy w strefie UTC
 *  zamiast Europe/Warsaw. */
export function formatDayLabel(dateIso: string): string {
  const { y, m, d } = parseIsoDate(dateIso);
  return dateTimeFormat({
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
