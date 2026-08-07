import { dateTimeFormat } from '../../core/i18n/intl';
import type { TranslationKey } from '../../core/i18n/pl';
import { translate } from '../../core/i18n/translate';
import { addDays, formatDayLabel, startOfWeekMonday } from '../calendar/calendar-date';

/**
 * Zakresy dat dashboardu statystyk (#56). Cała arytmetyka na datach kalendarzowych
 * („YYYY-MM-DD"), nigdy na instantach — tydzień/miesiąc to pojęcia lokalne firmy, a backend
 * przyjmuje dokładnie takie `from`/`to` (jak GET /businesses/mine/bookings, #31).
 *
 * Tygodnie i etykiety dni reużywają helperów kalendarza (`calendar-date.ts`) — drugiej
 * implementacji „poniedziałku tygodnia" w tym samym panelu być nie może.
 */

export type StatsPreset = 'week' | 'month' | 'custom';

export const STATS_PRESETS: { value: StatsPreset; labelKey: TranslationKey }[] = [
  { value: 'week', labelKey: 'stats.preset.week' },
  { value: 'month', labelKey: 'stats.preset.month' },
  { value: 'custom', labelKey: 'stats.preset.custom' },
];

export interface StatsRange {
  from: string;
  to: string;
}

/** Ziarnistość osi — lustro `granularityFor` z apps/api/.../stats/stats-buckets.ts. */
export type StatsGranularity = 'day' | 'week';

export const isStatsPreset = (value: string): value is StatsPreset =>
  STATS_PRESETS.some((preset) => preset.value === value);

const parts = (dateIso: string): [number, number, number] => {
  const [year, month, day] = dateIso.split('-').map(Number);
  return [year, month, day];
};

const toIso = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

export const firstOfMonth = (dateIso: string): string => {
  const [year, month] = parts(dateIso);
  return toIso(Date.UTC(year, month - 1, 1));
};

/** Dzień 0 kolejnego miesiąca to ostatni dzień tego — bez tablicy długości miesięcy. */
export const lastOfMonth = (dateIso: string): string => {
  const [year, month] = parts(dateIso);
  return toIso(Date.UTC(year, month, 0));
};

/** Zakres presetu wokół daty zakotwiczenia; `custom` zakresu nie wyznacza (rządzą pola formularza). */
export function rangeForPreset(preset: Exclude<StatsPreset, 'custom'>, anchorIso: string): StatsRange {
  if (preset === 'week') {
    const from = startOfWeekMonday(anchorIso);
    return { from, to: addDays(from, 6) };
  }
  return { from: firstOfMonth(anchorIso), to: lastOfMonth(anchorIso) };
}

/**
 * Przewinięcie zakotwiczenia o okres wstecz/wprzód. Dla miesiąca kotwiczymy na pierwszym dniu,
 * żeby „31 marca − 1 miesiąc" nie przeskoczyło na marzec (Date.UTC przewinąłby 31 lutego).
 */
export function shiftAnchor(
  preset: Exclude<StatsPreset, 'custom'>,
  anchorIso: string,
  delta: -1 | 1,
): string {
  if (preset === 'week') {
    return addDays(startOfWeekMonday(anchorIso), delta * 7);
  }
  const [year, month] = parts(anchorIso);
  return toIso(Date.UTC(year, month - 1 + delta, 1));
}

/** Opis zakresu nad wykresem: „sierpień 2026" dla miesiąca, „pon., 3 sie – nd., 9 sie" dla reszty. */
export function rangeLabel(preset: StatsPreset, range: StatsRange): string {
  if (preset === 'month') {
    const [year, month] = parts(range.from);
    return dateTimeFormat({
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }
  return `${formatDayLabel(range.from)} – ${formatDayLabel(range.to)}`;
}

/** Etykieta kubełka na osi X — dla tygodnia zaznaczamy, że to początek okresu. */
export function bucketLabel(dateIso: string, granularity: StatsGranularity): string {
  const day = formatDayLabel(dateIso);
  return granularity === 'week' ? translate('stats.bucket.weekFrom', { day }) : day;
}

/** Minuty → „6 h 30 min" / „45 min"; obłożenie czyta się w godzinach, nie w 390 minutach. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) {
    return translate('stats.duration.minutes', { minutes: rest });
  }
  return rest
    ? translate('stats.duration.hoursMinutes', { hours, minutes: rest })
    : translate('stats.duration.hours', { hours });
}
