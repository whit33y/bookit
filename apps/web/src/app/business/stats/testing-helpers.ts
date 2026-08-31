import type { BookingStatus } from '../calendar/booking-details-dialog';
import type {
  BusinessStatsResponse,
  StatsTotals,
  StatusCounts,
} from './stats-response';

/**
 * Atrapa odpowiedzi `GET /businesses/mine/stats` dla speków, które statystyk nie testują,
 * a tylko muszą domknąć żądanie i podać liczby (kafelek pulpitu #134 i sam pulpit #132).
 * Wzór jak `public/testing-helpers.ts` — moduł pomocniczy obok kodu, nie plik `.spec.ts`.
 *
 * Kształt trzymamy w jednym miejscu, bo powielony rozjeżdża się przy pierwszej zmianie API;
 * `stats.spec.ts` zostaje przy własnej, bogatszej atrapie — tam serie, pracownicy i usługi
 * niosą treść asercji, więc czytają się lepiej u siebie w pliku.
 */

const STATUSES: BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_BUSINESS',
  'COMPLETED',
];

export const statusCounts = (
  partial: Partial<StatusCounts> = {},
): StatusCounts => ({
  ...(Object.fromEntries(
    STATUSES.map((status) => [status, 0]),
  ) as StatusCounts),
  ...partial,
});

export const statsTotals = (
  overrides: Partial<StatsTotals> = {},
): StatsTotals => ({
  bookings: 12,
  byStatus: statusCounts({ COMPLETED: 9, PENDING: 3 }),
  completedBookings: 9,
  completedRevenueCents: 21000,
  bookedMinutes: 150,
  capacityMinutes: 2400,
  occupancyPercent: 6,
  ...overrides,
});

/** Pełna koperta odpowiedzi; nadpisujemy tylko `totals`, bo tyle czyta kafelek. */
export const businessStatsResponse = (
  totals: Partial<StatsTotals> = {},
): BusinessStatsResponse => ({
  range: { from: '2026-08-01', to: '2026-08-31', granularity: 'day' },
  totals: statsTotals(totals),
  series: [],
  employees: [],
  topServices: [],
});
