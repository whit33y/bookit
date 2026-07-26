import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canClientCancel,
  cancellationDeadline,
  cancellationWindowMessage,
} from './cancellation-policy';

const STARTS_AT = new Date('2026-01-14T12:00:00.000Z');
const HOURS = 24;
// dokładnie 24 h przed startem — moment graniczny polityki
const DEADLINE = new Date('2026-01-13T12:00:00.000Z');

describe('cancellationDeadline', () => {
  it('odejmuje cancellationHours od startu wizyty', () => {
    expect(cancellationDeadline(STARTS_AT, HOURS)).toEqual(DEADLINE);
  });

  it('cancellationHours = 0 → deadline równy startowi wizyty', () => {
    expect(cancellationDeadline(STARTS_AT, 0)).toEqual(STARTS_AT);
  });
});

describe('canClientCancel', () => {
  const cancel = (status: BookingStatus, now: Date, hours = HOURS) =>
    canClientCancel(status, STARTS_AT, hours, now);

  describe('CONFIRMED — okno czasowe', () => {
    // AC #27: „testy graniczne polityki (dokładnie X godzin przed startem)".
    // SDD §7 daje ostrą nierówność `now < startsAt − cancellationHours`, więc moment
    // graniczny należy już do firmy.
    it('dokładnie X godzin przed startem → nie wolno', () => {
      expect(cancel(BookingStatus.CONFIRMED, DEADLINE)).toBe(false);
    });

    it('milisekunda przed granicą → wolno', () => {
      expect(cancel(BookingStatus.CONFIRMED, new Date(DEADLINE.getTime() - 1))).toBe(true);
    });

    it('milisekunda po granicy → nie wolno', () => {
      expect(cancel(BookingStatus.CONFIRMED, new Date(DEADLINE.getTime() + 1))).toBe(false);
    });

    it('długo przed granicą → wolno', () => {
      expect(cancel(BookingStatus.CONFIRMED, new Date('2026-01-01T00:00:00.000Z'))).toBe(
        true,
      );
    });

    it('po rozpoczęciu wizyty → nie wolno', () => {
      expect(cancel(BookingStatus.CONFIRMED, new Date('2026-01-14T13:00:00.000Z'))).toBe(
        false,
      );
    });

    it('cancellationHours = 0 → wolno aż do startu, ale nie w jego momencie', () => {
      expect(cancel(BookingStatus.CONFIRMED, new Date(STARTS_AT.getTime() - 1), 0)).toBe(
        true,
      );
      expect(cancel(BookingStatus.CONFIRMED, STARTS_AT, 0)).toBe(false);
    });
  });

  describe('PENDING — bez okna', () => {
    it('wolno długo przed startem', () => {
      expect(cancel(BookingStatus.PENDING, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('wolno także po przekroczeniu granicy polityki', () => {
      expect(cancel(BookingStatus.PENDING, new Date(DEADLINE.getTime() + 1))).toBe(true);
    });

    it('wolno nawet po rozpoczęciu wizyty — polityka dotyczy tylko CONFIRMED', () => {
      expect(cancel(BookingStatus.PENDING, new Date('2026-01-14T13:00:00.000Z'))).toBe(true);
    });
  });

  describe('stany terminalne', () => {
    const TERMINAL = [
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CLIENT,
      BookingStatus.CANCELLED_BY_BUSINESS,
      BookingStatus.COMPLETED,
    ];

    it.each(TERMINAL)('%s nie da się odwołać, choćby czasu było dużo', (status) => {
      expect(cancel(status, new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
    });
  });
});

describe('cancellationWindowMessage', () => {
  it('podaje limit godzin z polityki firmy', () => {
    expect(cancellationWindowMessage(HOURS)).toContain('24');
  });

  it.each([
    [1, 'godzinę'],
    [2, 'godziny'],
    [4, 'godziny'],
    [24, 'godziny'],
    [22, 'godziny'],
    [5, 'godzin'],
    [11, 'godzin'],
    [12, 'godzin'],
    [14, 'godzin'],
    [21, 'godzin'],
    [0, 'godzin'],
  ])('%i → „%s"', (hours, form) => {
    expect(cancellationWindowMessage(hours)).toContain(`${hours} ${form}`);
  });
});
