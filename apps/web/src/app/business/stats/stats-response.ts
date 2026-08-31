import type { BookingStatus } from '../calendar/booking-details-dialog';
import type { StatsGranularity } from './stats-range';

/**
 * Lustro `BusinessStats` z apps/api/.../stats/stats.service.ts (#56) — kształt odpowiedzi
 * `GET /businesses/mine/stats`. Repo nie ma wspólnej libki DTO (patrz `core/api-client.ts`),
 * więc kontrakt jest po stronie web powielony ręcznie.
 *
 * Typy stoją osobno od `stats.ts`, bo czyta je też kafelek pulpitu (#134): dwa czytniki tej
 * samej odpowiedzi nie mogą mieć dwóch opisów jej kształtu — rozjechałyby się przy pierwszej
 * zmianie w API.
 */

export type StatusCounts = Record<BookingStatus, number>;

export interface StatsTotals {
  bookings: number;
  byStatus: StatusCounts;
  completedBookings: number;
  completedRevenueCents: number;
  bookedMinutes: number;
  capacityMinutes: number;
  /** `null`, gdy firma nie ma grafiku w zakresie — obłożenia nie ma z czego policzyć. */
  occupancyPercent: number | null;
}

export interface SeriesBucket {
  bucket: string;
  total: number;
  byStatus: StatusCounts;
}

export interface EmployeeOccupancy {
  employeeId: string;
  name: string;
  bookings: number;
  bookedMinutes: number;
  capacityMinutes: number;
  occupancyPercent: number | null;
}

export interface TopService {
  serviceId: string;
  name: string;
  bookings: number;
  revenueCents: number;
}

export interface BusinessStatsResponse {
  range: { from: string; to: string; granularity: StatsGranularity };
  totals: StatsTotals;
  series: SeriesBucket[];
  employees: EmployeeOccupancy[];
  topServices: TopService[];
}
