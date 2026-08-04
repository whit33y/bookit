import { BookingStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from './stats.service';

// Cztery agregaty w kolejności z Promise.all: seria, przychód, top usługi, obłożenie.
const results = {
  series: [{ bucket: '2026-08-03', status: BookingStatus.CONFIRMED, count: 2 }],
  revenue: [{ bookings: 1, revenueCents: 7000 }],
  topServices: [{ serviceId: 's1', name: 'Strzyżenie', bookings: 3, revenueCents: 7000 }],
  occupancy: [
    {
      employeeId: 'e1',
      name: 'Marek',
      bookings: 2,
      bookedMinutes: 90,
      capacityMinutes: 480,
    },
    {
      employeeId: 'e2',
      name: 'Zofia',
      bookings: 0,
      bookedMinutes: 0,
      capacityMinutes: 0,
    },
  ],
};

interface SqlLike {
  strings: string[];
  values: unknown[];
}

const isSqlLike = (value: unknown): value is SqlLike =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { strings?: unknown }).strings);

/**
 * `$queryRaw` jest wołane jako tagged template, więc atrapa dostaje surowe fragmenty i wartości —
 * w tym zagnieżdżone `Prisma.sql` (granice zakresu, lista statusów), których prawdziwa Prisma
 * spłaszcza sama. Tutaj składamy je z powrotem: pełny SQL do asercji o treści zapytania
 * i płaska lista parametrów do asercji o wartościach.
 */
const render = (strings: string[], values: unknown[]): { sql: string; params: unknown[] } => {
  let sql = '';
  const params: unknown[] = [];

  strings.forEach((chunk, i) => {
    sql += chunk;
    if (i >= values.length) {
      return;
    }
    const value = values[i];
    if (isSqlLike(value)) {
      const nested = render(value.strings, value.values);
      sql += nested.sql;
      params.push(...nested.params);
    } else {
      sql += '?';
      params.push(value);
    }
  });

  return { sql, params };
};

const callOf = (queryRaw: ReturnType<typeof vi.fn>, index: number) => {
  const [strings, ...values] = queryRaw.mock.calls[index];
  return render(strings as unknown as string[], values);
};

const sqlOf = (queryRaw: ReturnType<typeof vi.fn>, index: number): string =>
  callOf(queryRaw, index).sql;

const params = (queryRaw: ReturnType<typeof vi.fn>, index: number): unknown[] =>
  callOf(queryRaw, index).params;

describe('StatsService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let service: StatsService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    queryRaw = vi
      .fn()
      .mockResolvedValueOnce(results.series)
      .mockResolvedValueOnce(results.revenue)
      .mockResolvedValueOnce(results.topServices)
      .mockResolvedValueOnce(results.occupancy);
    const prisma = {
      business: { findUnique: businessFindUnique },
      $queryRaw: queryRaw,
    };
    service = new StatsService(prisma as unknown as PrismaService);
  });

  const query = { from: '2026-08-03', to: '2026-08-09' };

  it('składa odpowiedź z czterech agregatów, dokłada zerowe kubełki i procenty', async () => {
    const stats = await service.findForBusiness('owner-1', query);

    expect(stats.range).toEqual({ from: '2026-08-03', to: '2026-08-09', granularity: 'day' });
    expect(stats.totals.bookings).toBe(2);
    expect(stats.totals.byStatus[BookingStatus.CONFIRMED]).toBe(2);
    expect(stats.totals.byStatus[BookingStatus.PENDING]).toBe(0);
    expect(stats.totals.completedBookings).toBe(1);
    expect(stats.totals.completedRevenueCents).toBe(7000);
    // suma po pracownikach: 90/480 → 19 %
    expect(stats.totals.bookedMinutes).toBe(90);
    expect(stats.totals.capacityMinutes).toBe(480);
    expect(stats.totals.occupancyPercent).toBe(19);
    expect(stats.series).toHaveLength(7);
    expect(stats.series[0]).toMatchObject({ bucket: '2026-08-03', total: 2 });
    expect(stats.series[1].total).toBe(0);
    expect(stats.topServices).toEqual(results.topServices);
  });

  it('pracownik bez grafiku dostaje occupancyPercent null, nie 0', async () => {
    const stats = await service.findForBusiness('owner-1', query);

    expect(stats.employees[0]).toMatchObject({ employeeId: 'e1', occupancyPercent: 19 });
    expect(stats.employees[1]).toMatchObject({ employeeId: 'e2', occupancyPercent: null });
  });

  it('bierze firmę z tokena właściciela (ownerId), nie z query', async () => {
    await service.findForBusiness('owner-1', query);

    expect(businessFindUnique).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1' },
      select: { id: true },
    });
    // businessId w każdym z czterech zapytań
    for (let i = 0; i < 4; i++) {
      expect(params(queryRaw, i)).toContain('b1');
    }
  });

  it('brak firmy przy ważnym tokenie OWNER → 404 i żadnego agregatu', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(service.findForBusiness('owner-1', query)).rejects.toMatchObject({
      status: 404,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('to wcześniejsze niż from → 400', async () => {
    await expect(
      service.findForBusiness('owner-1', { from: '2026-08-09', to: '2026-08-03' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(businessFindUnique).not.toHaveBeenCalled();
  });

  it('data nieistniejąca w kalendarzu → 400', async () => {
    await expect(
      service.findForBusiness('owner-1', { from: '2026-02-30', to: '2026-03-05' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('zakres dłuższy niż rok → 400 (generate_series obłożenia rośnie liniowo)', async () => {
    await expect(
      service.findForBusiness('owner-1', { from: '2026-01-01', to: '2027-06-01' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('zakres powyżej 31 dni przechodzi na kubełki tygodniowe i przekazuje je do date_trunc', async () => {
    queryRaw.mockReset();
    queryRaw
      .mockResolvedValueOnce([{ bucket: '2026-08-03', status: BookingStatus.COMPLETED, count: 1 }])
      .mockResolvedValueOnce(results.revenue)
      .mockResolvedValueOnce(results.topServices)
      .mockResolvedValueOnce(results.occupancy);

    const stats = await service.findForBusiness('owner-1', {
      from: '2026-08-03',
      to: '2026-09-27',
    });

    expect(stats.range.granularity).toBe('week');
    expect(params(queryRaw, 0)).toContain('week');
    expect(stats.series).toHaveLength(8);
    expect(stats.series.map((b) => b.bucket)).toContain('2026-09-21');
  });

  it('kubełki liczy w strefie firmy, a granice zakresu jako UTC bez strefy', async () => {
    await service.findForBusiness('owner-1', query);

    const seriesSql = sqlOf(queryRaw, 0);
    expect(seriesSql).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE `);
    expect(seriesSql).toContain('::timestamp');
    // 3 sierpnia 00:00 w Warszawie to 2 sierpnia 22:00 UTC
    expect(params(queryRaw, 0)).toContain('2026-08-02T22:00:00.000Z');
    expect(params(queryRaw, 0)).toContain('2026-08-09T22:00:00.000Z');
  });

  it('przychód liczy tylko COMPLETED i po cenie usługi, nie po zaliczce', async () => {
    await service.findForBusiness('owner-1', query);

    const revenueSql = sqlOf(queryRaw, 1);
    expect(revenueSql).toContain(`b.status = 'COMPLETED'`);
    expect(revenueSql).toContain('SUM(s."priceCents")');
    expect(revenueSql).not.toContain('Payment');
  });

  it('obłożenie odejmuje urlopy od grafiku i przycina rezerwacje do zakresu', async () => {
    await service.findForBusiness('owner-1', query);

    const occupancySql = sqlOf(queryRaw, 3);
    expect(occupancySql).toContain('generate_series');
    expect(occupancySql).toContain('"TimeOff"');
    expect(occupancySql).toContain('LEAST(b."endsAt"');
    // odwołane i odrzucone nie zajmują grafiku
    expect(occupancySql).toContain(`('PENDING', 'CONFIRMED', 'COMPLETED')`);
    // lokalne daty (nie instanty) idą do generate_series
    expect(params(queryRaw, 3)).toContain('2026-08-03');
    expect(params(queryRaw, 3)).toContain('2026-08-09');
  });

  it('licznik obłożenia bierze rezerwacje po tym samym warunku co seria (start w zakresie)', async () => {
    await service.findForBusiness('owner-1', query);

    // ten sam zbiór rezerwacji co seria: inaczej wizyta zaczęta przed zakresem dokładała
    // minuty i rezerwację do obłożenia, nie licząc się w KPI „Rezerwacje"
    const bookedWhere = sqlOf(queryRaw, 3).split('booked AS (')[1].split('GROUP BY')[0];
    expect(bookedWhere).toContain('b."startsAt" >= ');
    expect(bookedWhere).toContain('b."startsAt" < ');
    expect(bookedWhere).not.toContain('b."endsAt" > ');
  });
});
