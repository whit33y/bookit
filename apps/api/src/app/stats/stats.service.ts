import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BUSINESS_TIMEZONE,
  localDayRangeUtc,
  parseLocalDate,
} from '../availability/business-time';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessStatsQueryDto } from './dto/business-stats-query.dto';
import {
  MAX_RANGE_DAYS,
  SeriesBucket,
  StatsGranularity,
  StatusBucketRow,
  StatusCounts,
  bucketKeys,
  countAll,
  fillSeries,
  granularityFor,
  occupancyPercent,
  rangeDays,
  sumByStatus,
} from './stats-buckets';

/**
 * Statusy, które zajmują kalendarz pracownika — licznik obłożenia i „popularność" usługi.
 * BLOCKING_STATUSES z availability to PENDING + CONFIRMED (patrzy w przyszłość); tutaj
 * dochodzi COMPLETED, bo dashboard patrzy głównie wstecz, na wizyty już odbyte.
 */
const OCCUPYING_STATUSES = Prisma.sql`('PENDING', 'CONFIRMED', 'COMPLETED')`;

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

export interface BusinessStats {
  range: { from: string; to: string; granularity: StatsGranularity };
  totals: {
    bookings: number;
    byStatus: StatusCounts;
    completedBookings: number;
    completedRevenueCents: number;
    bookedMinutes: number;
    capacityMinutes: number;
    occupancyPercent: number | null;
  };
  series: SeriesBucket[];
  employees: EmployeeOccupancy[];
  topServices: TopService[];
}

interface RevenueRow {
  bookings: number;
  revenueCents: number;
}

interface OccupancyRow {
  employeeId: string;
  name: string;
  bookings: number;
  bookedMinutes: number;
  capacityMinutes: number;
}

const TOP_SERVICES_LIMIT = 5;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ownerId @unique → własna firma z tokena; brak firmy (ważny token OWNER) → 404.
  // Ten sam prywatny helper co w EmployeesService/ServicesService — repo nie ma wspólnego.
  private async resolveBusinessId(userId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }
    return business.id;
  }

  async findForBusiness(userId: string, query: BusinessStatsQueryDto): Promise<BusinessStats> {
    const fromUtc = localDayRangeUtc(parseLocalDate(query.from)).startUtc;
    const toUtc = localDayRangeUtc(parseLocalDate(query.to)).endUtc;
    if (toUtc <= fromUtc) {
      throw new BadRequestException('to musi być późniejsze niż from');
    }
    if (rangeDays(query.from, query.to) > MAX_RANGE_DAYS) {
      throw new BadRequestException('Zakres nie może przekraczać roku');
    }

    const businessId = await this.resolveBusinessId(userId);
    const granularity = granularityFor(query.from, query.to);

    // Cztery agregaty naraz, każdy policzony przez bazę. Kolumny czasu to TIMESTAMP(3) bez
    // strefy trzymające UTC, więc parametry idą jako ISO z jawnym ::timestamp — bez tego
    // sterownik wysłałby timestamptz i porównanie zależałoby od ustawienia TimeZone sesji.
    const from = Prisma.sql`${fromUtc.toISOString()}::timestamp`;
    const to = Prisma.sql`${toUtc.toISOString()}::timestamp`;

    const [statusRows, [revenue], topServices, occupancy] = await Promise.all([
      this.statusSeries(businessId, from, to, granularity),
      this.revenue(businessId, from, to),
      this.topServices(businessId, from, to),
      this.occupancy(businessId, query, from, to),
    ]);

    const byStatus = sumByStatus(statusRows);
    const bookedMinutes = occupancy.reduce((sum, row) => sum + row.bookedMinutes, 0);
    const capacityMinutes = occupancy.reduce((sum, row) => sum + row.capacityMinutes, 0);

    return {
      range: { from: query.from, to: query.to, granularity },
      totals: {
        bookings: countAll(byStatus),
        byStatus,
        completedBookings: revenue.bookings,
        completedRevenueCents: revenue.revenueCents,
        bookedMinutes,
        capacityMinutes,
        occupancyPercent: occupancyPercent(bookedMinutes, capacityMinutes),
      },
      series: fillSeries(statusRows, bucketKeys(query.from, query.to, granularity)),
      employees: occupancy.map((row) => ({
        ...row,
        occupancyPercent: occupancyPercent(row.bookedMinutes, row.capacityMinutes),
      })),
      topServices,
    };
  }

  /**
   * Rezerwacje wg statusu w czasie. Zakres po `startsAt` (zawieranie), nie po nachodzeniu jak
   * w kalendarzu (#31): na dashboardzie „rezerwacja z 5 sierpnia" to ta, która się wtedy
   * zaczyna — wizyta przechodząca przez północ nie ma się liczyć dwa razy.
   *
   * Kubełki po lokalnej dobie firmy: kolumna trzyma UTC jako timestamp bez strefy, więc
   * najpierw oznaczamy ją jako UTC, a potem tłumaczymy na ścianę zegara firmy. Bez tego
   * wizyta o 23:30 w Warszawie wpadłaby do poprzedniego dnia. `to_char` zamiast `::date`,
   * bo typ `date` wraca ze sterownika jako Date w strefie procesu.
   */
  private statusSeries(
    businessId: string,
    from: Prisma.Sql,
    to: Prisma.Sql,
    granularity: StatsGranularity,
  ) {
    return this.prisma.$queryRaw<StatusBucketRow[]>`
      SELECT
        to_char(
          date_trunc(
            ${granularity},
            b."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BUSINESS_TIMEZONE}
          ),
          'YYYY-MM-DD'
        ) AS bucket,
        b.status::text AS status,
        COUNT(*)::int AS count
      FROM "Booking" b
      WHERE b."businessId" = ${businessId}
        AND b."startsAt" >= ${from}
        AND b."startsAt" < ${to}
      GROUP BY 1, 2
    `;
  }

  /**
   * Suma cen zrealizowanych wizyt. Cena z `Service.priceCents`, nie z `Payment.amountCents` —
   * płatność to tylko zaliczka. Rezerwacja nie ma zdenormalizowanej ceny, więc zmiana cennika
   * przepisuje też historyczny przychód; świadomy kompromis, alternatywą jest kolumna na Booking.
   */
  private revenue(businessId: string, from: Prisma.Sql, to: Prisma.Sql) {
    return this.prisma.$queryRaw<RevenueRow[]>`
      SELECT
        COUNT(*)::int AS bookings,
        COALESCE(SUM(s."priceCents"), 0)::int AS "revenueCents"
      FROM "Booking" b
      JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."businessId" = ${businessId}
        AND b.status = 'COMPLETED'
        AND b."startsAt" >= ${from}
        AND b."startsAt" < ${to}
    `;
  }

  /** Najpopularniejsze usługi — bez odwołanych i odrzuconych, te nie świadczą o popularności. */
  private topServices(businessId: string, from: Prisma.Sql, to: Prisma.Sql) {
    return this.prisma.$queryRaw<TopService[]>`
      SELECT
        s.id AS "serviceId",
        s.name,
        COUNT(*)::int AS bookings,
        COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN s."priceCents" ELSE 0 END), 0)::int
          AS "revenueCents"
      FROM "Booking" b
      JOIN "Service" s ON s.id = b."serviceId"
      WHERE b."businessId" = ${businessId}
        AND b.status IN ${OCCUPYING_STATUSES}
        AND b."startsAt" >= ${from}
        AND b."startsAt" < ${to}
      GROUP BY s.id, s.name
      ORDER BY bookings DESC, s.name ASC
      LIMIT ${TOP_SERVICES_LIMIT}
    `;
  }

  /**
   * Obłożenie per pracownik: zajęte minuty / (grafik − urlopy), wszystko w jednym zapytaniu.
   *
   * Mianownik powstaje z rozwinięcia grafiku na konkretne doby zakresu (`generate_series`
   * × `WorkingHours` po dniu tygodnia) — godziny są ścianą zegara firmy, więc wracają do UTC
   * odwrotnym `AT TIME ZONE` niż w serii. Od każdego okna odejmujemy część nachodzącą z urlopu;
   * `GREATEST(0, …)` chroni przed ujemną pojemnością, gdy urlopy się nakładają.
   *
   * Licznik liczy rezerwacje nachodzące na zakres (nie zaczynające się w nim) i przycina je do
   * jego granic — inaczej wizyta z 23:30 ostatniego dnia zawyżałaby obłożenie o czas spoza okna.
   *
   * Grafik przez północ (`endTime <= startTime`) jest poza modelem, tak samo jak w generateSlots.
   * Pracownik bez rezerwacji ma wiersz z zerami; nieaktywny wchodzi tylko z rezerwacjami
   * w zakresie — jak kolumny „extra" w kalendarzu (#32).
   */
  private occupancy(
    businessId: string,
    query: BusinessStatsQueryDto,
    from: Prisma.Sql,
    to: Prisma.Sql,
  ) {
    return this.prisma.$queryRaw<OccupancyRow[]>`
      WITH days AS (
        SELECT generate_series(${query.from}::date, ${query.to}::date, interval '1 day')::date AS day
      ),
      windows AS (
        SELECT
          wh."employeeId",
          ((d.day + wh."startTime"::time) AT TIME ZONE ${BUSINESS_TIMEZONE}) AT TIME ZONE 'UTC'
            AS win_start,
          ((d.day + wh."endTime"::time) AT TIME ZONE ${BUSINESS_TIMEZONE}) AT TIME ZONE 'UTC'
            AS win_end
        FROM days d
        JOIN "WorkingHours" wh ON wh.weekday = EXTRACT(ISODOW FROM d.day)::int - 1
        JOIN "Employee" e ON e.id = wh."employeeId"
        WHERE e."businessId" = ${businessId}
          AND wh."endTime" > wh."startTime"
      ),
      capacity AS (
        SELECT
          w."employeeId",
          SUM(
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (w.win_end - w.win_start)) / 60
              - COALESCE((
                  SELECT SUM(
                    EXTRACT(EPOCH FROM (
                      LEAST(t."endsAt", w.win_end) - GREATEST(t."startsAt", w.win_start)
                    )) / 60
                  )
                  FROM "TimeOff" t
                  WHERE t."employeeId" = w."employeeId"
                    AND t."startsAt" < w.win_end
                    AND t."endsAt" > w.win_start
                ), 0)
            )
          ) AS minutes
        FROM windows w
        GROUP BY 1
      ),
      booked AS (
        SELECT
          b."employeeId",
          COUNT(*)::int AS bookings,
          SUM(
            EXTRACT(EPOCH FROM (
              LEAST(b."endsAt", ${to}) - GREATEST(b."startsAt", ${from})
            )) / 60
          ) AS minutes
        FROM "Booking" b
        WHERE b."businessId" = ${businessId}
          AND b.status IN ${OCCUPYING_STATUSES}
          AND b."startsAt" < ${to}
          AND b."endsAt" > ${from}
        GROUP BY 1
      )
      SELECT
        e.id AS "employeeId",
        e.name,
        COALESCE(bk.bookings, 0)::int AS bookings,
        COALESCE(ROUND(bk.minutes), 0)::int AS "bookedMinutes",
        COALESCE(ROUND(cap.minutes), 0)::int AS "capacityMinutes"
      FROM "Employee" e
      LEFT JOIN booked bk ON bk."employeeId" = e.id
      LEFT JOIN capacity cap ON cap."employeeId" = e.id
      WHERE e."businessId" = ${businessId}
        AND (e."isActive" OR bk."employeeId" IS NOT NULL)
      ORDER BY e.name ASC
    `;
  }
}
