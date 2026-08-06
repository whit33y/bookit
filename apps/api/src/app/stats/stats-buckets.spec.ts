import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  StatusBucketRow,
  bucketKeys,
  countAll,
  fillSeries,
  granularityFor,
  occupancyPercent,
  rangeDays,
  sumByStatus,
} from './stats-buckets';

const row = (bucket: string, status: BookingStatus, count: number): StatusBucketRow => ({
  bucket,
  status,
  count,
});

describe('rangeDays', () => {
  it('ten sam dzień to jeden dzień, nie zero', () => {
    expect(rangeDays('2026-08-03', '2026-08-03')).toBe(1);
  });

  it('liczy obie granice włącznie', () => {
    expect(rangeDays('2026-08-03', '2026-08-09')).toBe(7);
  });

  it('przechodzi przez zmianę czasu bez zgubienia doby', () => {
    // 25 października 2026 — powrót z czasu letniego; arytmetyka idzie po UTC, więc 31 dni
    expect(rangeDays('2026-10-01', '2026-10-31')).toBe(31);
  });
});

describe('granularityFor', () => {
  it('do 31 dni — kubełki dzienne', () => {
    expect(granularityFor('2026-08-01', '2026-08-31')).toBe('day');
  });

  it('powyżej 31 dni — kubełki tygodniowe', () => {
    expect(granularityFor('2026-08-01', '2026-09-01')).toBe('week');
  });
});

describe('bucketKeys', () => {
  it('dzienne: każda data zakresu, rosnąco', () => {
    expect(bucketKeys('2026-08-03', '2026-08-06', 'day')).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
    ]);
  });

  it('tygodniowe: startuje od poniedziałku sprzed `from`, jak date_trunc(week)', () => {
    // 2026-08-05 to środa, jej tydzień zaczyna się 3 sierpnia (poniedziałek)
    expect(bucketKeys('2026-08-05', '2026-08-20', 'week')).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
    ]);
  });

  it('zakres krótszy niż tydzień daje jeden kubełek', () => {
    expect(bucketKeys('2026-08-03', '2026-08-04', 'week')).toEqual(['2026-08-03']);
  });
});

describe('fillSeries', () => {
  it('uzupełnia zera dla dni bez rezerwacji i liczy total z rozkładu', () => {
    const keys = bucketKeys('2026-08-03', '2026-08-05', 'day');
    const series = fillSeries(
      [
        row('2026-08-03', BookingStatus.CONFIRMED, 2),
        row('2026-08-03', BookingStatus.PENDING, 1),
        row('2026-08-05', BookingStatus.COMPLETED, 4),
      ],
      keys,
    );

    expect(series.map((b) => b.bucket)).toEqual(keys);
    expect(series[0].total).toBe(3);
    expect(series[0].byStatus[BookingStatus.CONFIRMED]).toBe(2);
    expect(series[1].total).toBe(0);
    expect(series[1].byStatus[BookingStatus.PENDING]).toBe(0);
    expect(series[2].total).toBe(4);
  });

  it('każdy kubełek ma wszystkie statusy enuma — front rysuje stały zestaw serii', () => {
    const [bucket] = fillSeries([], ['2026-08-03']);

    expect(Object.keys(bucket.byStatus).sort()).toEqual(Object.values(BookingStatus).sort());
  });

  it('wiersz spoza osi nie dorabia kubełka', () => {
    const series = fillSeries([row('2026-09-01', BookingStatus.PENDING, 9)], ['2026-08-03']);

    expect(series).toHaveLength(1);
    expect(series[0].total).toBe(0);
  });

  it('nie współdzieli obiektów między wywołaniami (wynik idzie prosto do odpowiedzi HTTP)', () => {
    const first = fillSeries([row('2026-08-03', BookingStatus.PENDING, 1)], ['2026-08-03']);
    const second = fillSeries([], ['2026-08-03']);

    expect(first[0].byStatus[BookingStatus.PENDING]).toBe(1);
    expect(second[0].byStatus[BookingStatus.PENDING]).toBe(0);
  });
});

describe('sumByStatus / countAll', () => {
  it('sumuje po statusach niezależnie od kubełka', () => {
    const totals = sumByStatus([
      row('2026-08-03', BookingStatus.CONFIRMED, 2),
      row('2026-08-04', BookingStatus.CONFIRMED, 3),
      row('2026-08-04', BookingStatus.DECLINED, 1),
    ]);

    expect(totals[BookingStatus.CONFIRMED]).toBe(5);
    expect(totals[BookingStatus.DECLINED]).toBe(1);
    expect(totals[BookingStatus.PENDING]).toBe(0);
    expect(countAll(totals)).toBe(6);
  });
});

describe('occupancyPercent', () => {
  it('zaokrągla do pełnego procenta', () => {
    expect(occupancyPercent(90, 480)).toBe(19);
  });

  it('brak grafiku → null, nie 0 (0 % sugerowałoby wolne terminy)', () => {
    expect(occupancyPercent(0, 0)).toBeNull();
    expect(occupancyPercent(60, 0)).toBeNull();
  });

  it('nie przycina do 100 % — rezerwacja poza grafikiem ma być widoczna', () => {
    expect(occupancyPercent(600, 480)).toBe(125);
  });
});
