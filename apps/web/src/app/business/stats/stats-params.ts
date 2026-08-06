import { ParamMap } from '@angular/router';
import { isCalendarDate } from '../calendar/calendar-date';
import { StatsPreset, StatsRange, isStatsPreset, rangeForPreset } from './stats-range';

/** Stan dashboardu zapisywany w adresie — preset plus konkretny zakres dat. */
export interface StatsParams {
  preset: StatsPreset;
  range: StatsRange;
}

/**
 * Odczyt zakresu z `queryParamMap` (wzór: `admin/admin-list-params.ts`). Wszystko, co nie pasuje
 * do kontraktu — nieznany preset, data w złym formacie albo nieistniejąca w kalendarzu,
 * odwrócony zakres — jest po cichu pomijane: URL bywa wpisany ręcznie albo pochodzi ze starego
 * linku, a to nie powód, żeby właściciel dostał 400 z API zamiast statystyk.
 *
 * `today` wstrzykiwane, bo domyślny zakres zależy od dzisiejszej daty w strefie firmy, a testy
 * muszą móc podać stały dzień.
 */
export function readStatsParams(params: ParamMap, today: string): StatsParams {
  const rawPreset = params.get('preset');
  const preset: StatsPreset =
    rawPreset && isStatsPreset(rawPreset) ? rawPreset : 'month';

  const from = params.get('from');
  const to = params.get('to');
  if (from && to && isCalendarDate(from) && isCalendarDate(to) && from <= to) {
    return { preset, range: { from, to } };
  }

  // Bez poprawnego zakresu w adresie „własny" nie ma z czego powstać — wraca domyślny miesiąc
  // (razem z presetem, żeby przełącznik nie pokazywał „Własny" dla zakresu miesięcznego).
  if (preset === 'custom') {
    return { preset: 'month', range: rangeForPreset('month', today) };
  }
  return { preset, range: rangeForPreset(preset, today) };
}

/** Parametry adresu dla `router.navigate` — pełny stan, żeby link dał się odtworzyć. */
export function buildStatsQueryParams({ preset, range }: StatsParams): Record<string, string> {
  return { preset, from: range.from, to: range.to };
}

/** Ścieżka z querystringiem dla `ApiClient` (bez prefiksu /api); API przyjmuje tylko from/to. */
export function statsPath(range: StatsRange): string {
  return `/businesses/mine/stats?${new URLSearchParams({
    from: range.from,
    to: range.to,
  })}`;
}
