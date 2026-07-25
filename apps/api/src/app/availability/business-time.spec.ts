import { describe, expect, it } from 'vitest';
import {
  ceilToSlotGrid,
  isOnSlotGrid,
  localDayRangeUtc,
  localWeekday,
  parseLocalDate,
  utcToLocalDate,
  zonedWallClockToUtc,
} from './business-time';

const HOUR_MS = 3_600_000;

describe('business-time', () => {
  describe('parseLocalDate', () => {
    it('rozkłada poprawną datę', () => {
      expect(parseLocalDate('2026-07-25')).toEqual({ year: 2026, month: 7, day: 25 });
    });

    it('data nieistniejąca w kalendarzu → 400', () => {
      expect(() => parseLocalDate('2026-02-30')).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
      expect(() => parseLocalDate('2026-13-01')).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    });

    it('29 lutego w roku przestępnym przechodzi', () => {
      expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    });
  });

  describe('zonedWallClockToUtc', () => {
    it('czas zimowy (CET, +1): 09:00 lokalnie → 08:00 UTC', () => {
      expect(zonedWallClockToUtc(parseLocalDate('2026-01-15'), '09:00').toISOString()).toBe(
        '2026-01-15T08:00:00.000Z',
      );
    });

    it('czas letni (CEST, +2): 09:00 lokalnie → 07:00 UTC', () => {
      expect(zonedWallClockToUtc(parseLocalDate('2026-07-15'), '09:00').toISOString()).toBe(
        '2026-07-15T07:00:00.000Z',
      );
    });

    it('godzina przed i po wiosennej zmianie czasu ma różny offset', () => {
      const day = parseLocalDate('2026-03-29');
      // 01:00 lokalnie jeszcze CET (+1), 03:00 już CEST (+2) — 02:00 lokalnie nie istnieje
      expect(zonedWallClockToUtc(day, '01:00').toISOString()).toBe('2026-03-29T00:00:00.000Z');
      expect(zonedWallClockToUtc(day, '03:00').toISOString()).toBe('2026-03-29T01:00:00.000Z');
    });

    it('godzina przed i po jesiennej zmianie czasu ma różny offset', () => {
      const day = parseLocalDate('2026-10-25');
      expect(zonedWallClockToUtc(day, '01:00').toISOString()).toBe('2026-10-24T23:00:00.000Z');
      expect(zonedWallClockToUtc(day, '04:00').toISOString()).toBe('2026-10-25T03:00:00.000Z');
    });
  });

  describe('localDayRangeUtc', () => {
    it('zwykła doba ma 24 h', () => {
      const { startUtc, endUtc } = localDayRangeUtc(parseLocalDate('2026-07-15'));
      expect(startUtc.toISOString()).toBe('2026-07-14T22:00:00.000Z');
      expect((endUtc.getTime() - startUtc.getTime()) / HOUR_MS).toBe(24);
    });

    it('doba wiosennej zmiany czasu ma 23 h', () => {
      const { startUtc, endUtc } = localDayRangeUtc(parseLocalDate('2026-03-29'));
      expect((endUtc.getTime() - startUtc.getTime()) / HOUR_MS).toBe(23);
    });

    it('doba jesiennej zmiany czasu ma 25 h', () => {
      const { startUtc, endUtc } = localDayRangeUtc(parseLocalDate('2026-10-25'));
      expect((endUtc.getTime() - startUtc.getTime()) / HOUR_MS).toBe(25);
    });

    it('koniec miesiąca przechodzi na kolejny miesiąc', () => {
      const { endUtc } = localDayRangeUtc(parseLocalDate('2026-01-31'));
      expect(endUtc.toISOString()).toBe('2026-01-31T23:00:00.000Z'); // 2026-02-01 00:00 CET
    });
  });

  describe('localWeekday', () => {
    // konwencja Prismy: 0 = poniedziałek … 6 = niedziela
    it.each([
      ['2026-07-20', 0], // poniedziałek
      ['2026-07-25', 5], // sobota
      ['2026-07-26', 6], // niedziela
    ])('%s → %i', (date, expected) => {
      expect(localWeekday(parseLocalDate(date))).toBe(expected);
    });
  });

  describe('ceilToSlotGrid', () => {
    it('zaokrągla w górę do pełnego kwadransa', () => {
      expect(ceilToSlotGrid(new Date('2026-07-15T09:07:00.000Z')).toISOString()).toBe(
        '2026-07-15T09:15:00.000Z',
      );
    });

    it('czas już na siatce zostaje bez zmian', () => {
      expect(ceilToSlotGrid(new Date('2026-07-15T09:30:00.000Z')).toISOString()).toBe(
        '2026-07-15T09:30:00.000Z',
      );
    });
  });

  describe('isOnSlotGrid', () => {
    it.each(['09:00', '09:15', '09:30', '09:45'])('%s jest na siatce', (time) => {
      expect(isOnSlotGrid(new Date(`2026-07-15T${time}:00.000Z`))).toBe(true);
    });

    it('minuty poza kwadransem → false', () => {
      expect(isOnSlotGrid(new Date('2026-07-15T09:07:00.000Z'))).toBe(false);
    });

    it('niezerowe sekundy i milisekundy → false', () => {
      expect(isOnSlotGrid(new Date('2026-07-15T09:15:30.000Z'))).toBe(false);
      expect(isOnSlotGrid(new Date('2026-07-15T09:15:00.001Z'))).toBe(false);
    });
  });

  describe('utcToLocalDate', () => {
    it('instant w środku doby lokalnej → jej data', () => {
      expect(utcToLocalDate(new Date('2026-07-15T07:00:00.000Z'))).toEqual({
        year: 2026,
        month: 7,
        day: 15,
      });
    });

    it('późny wieczór UTC to już kolejny dzień lokalnie (CEST, +2)', () => {
      expect(utcToLocalDate(new Date('2026-07-15T22:30:00.000Z'))).toEqual({
        year: 2026,
        month: 7,
        day: 16,
      });
    });

    it('doba zmiany czasu: instanty po obu stronach dają ten sam dzień lokalny', () => {
      // 2026-10-25 00:30Z to 02:30 CEST, 02:30Z to 03:30 CET — oba wciąż 25 października
      expect(utcToLocalDate(new Date('2026-10-25T00:30:00.000Z')).day).toBe(25);
      expect(utcToLocalDate(new Date('2026-10-25T02:30:00.000Z')).day).toBe(25);
    });

    it('jest odwrotnością zonedWallClockToUtc na poziomie daty', () => {
      const date = parseLocalDate('2026-01-31');
      expect(utcToLocalDate(zonedWallClockToUtc(date, '23:45'))).toEqual(date);
    });
  });
});
