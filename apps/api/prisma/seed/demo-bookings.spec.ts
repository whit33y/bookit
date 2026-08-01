import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  isOnSlotGrid,
  utcToLocalDate,
  zonedWallClockToUtc,
} from '../../src/app/availability/business-time';
import {
  fitsAnyInterval,
  overlapsAny,
} from '../../src/app/availability/slots.util';
import {
  PlannedBooking,
  planDemoBookings,
  planDemoTimeOffs,
  workIntervalsFor,
} from './demo-bookings';
import { DEMO_BUSINESSES, DemoEmployee } from './demo-data';

const MINUTE_MS = 60_000;

// okno crona przypomnień (#38): CONFIRMED z startsAt w 2 h – 24,25 h od teraz
const REMINDER_FLOOR_MS = 120 * MINUTE_MS;
const REMINDER_CEILING_MS = (1440 + 15) * MINUTE_MS;

const PAST_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.DECLINED,
  BookingStatus.CANCELLED_BY_CLIENT,
  BookingStatus.CANCELLED_BY_BUSINESS,
];

// spójność nazw pilnuje demo-data.spec.ts, więc tutaj brak trafienia to błąd testu, nie asercja
const employeeIn = (businessSlug: string, name: string): DemoEmployee => {
  const employee = DEMO_BUSINESSES.find(
    (b) => b.slug === businessSlug,
  )?.employees.find((e) => e.name === name);

  if (!employee) {
    throw new Error(`Brak pracownika "${name}" w firmie "${businessSlug}"`);
  }
  return employee;
};

const employeeOf = (booking: PlannedBooking): DemoEmployee =>
  employeeIn(booking.spec.businessSlug, booking.spec.employeeName);

const employeeKey = (booking: PlannedBooking) =>
  `${booking.spec.businessSlug}/${booking.spec.employeeName}`;

// zwykła środa, czas letni
const NOW = new Date('2026-08-12T09:37:11.000Z');

describe('planDemoBookings', () => {
  it('każda rezerwacja leży na siatce 15 minut i trwa tyle, co usługa', () => {
    for (const booking of planDemoBookings(NOW)) {
      expect(isOnSlotGrid(booking.startsAt)).toBe(true);
      expect(booking.endsAt).toEqual(
        addMinutes(booking.startsAt, booking.durationMin),
      );
    }
  });

  it('każda rezerwacja mieści się w grafiku swojego pracownika', () => {
    for (const booking of planDemoBookings(NOW)) {
      const intervals = workIntervalsFor(
        employeeOf(booking),
        utcToLocalDate(booking.startsAt),
      );
      expect(fitsAnyInterval(booking.startsAt, booking.endsAt, intervals)).toBe(
        true,
      );
    }
  });

  it('rezerwacje tego samego pracownika nie nachodzą na siebie ani na jego urlopy', () => {
    const bookings = planDemoBookings(NOW);
    const timeOffs = planDemoTimeOffs(NOW);
    const seen = new Map<string, { startsAt: Date; endsAt: Date }[]>();

    for (const booking of bookings) {
      const key = employeeKey(booking);
      const busy = [
        ...(seen.get(key) ?? []),
        ...timeOffs
          .filter(
            (t) => `${t.spec.businessSlug}/${t.spec.employeeName}` === key,
          )
          .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
      ];

      expect(overlapsAny(booking.startsAt, booking.endsAt, busy)).toBe(false);
      seen.set(key, [...(seen.get(key) ?? []), booking]);
    }
  });

  it('statusy zamknięte lądują w przeszłości, oczekujące i potwierdzone w przyszłości', () => {
    for (const booking of planDemoBookings(NOW)) {
      if (PAST_STATUSES.includes(booking.spec.status)) {
        expect(booking.endsAt.getTime()).toBeLessThan(NOW.getTime());
      } else {
        expect(booking.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it('żadne CONFIRMED nie wpada w okno crona przypomnień', () => {
    const confirmed = planDemoBookings(NOW).filter(
      (b) => b.spec.status === BookingStatus.CONFIRMED,
    );
    expect(confirmed.length).toBeGreaterThan(0);

    for (const booking of confirmed) {
      const ahead = booking.startsAt.getTime() - NOW.getTime();
      expect(ahead).toBeGreaterThan(REMINDER_CEILING_MS);
      expect(ahead).toBeGreaterThan(REMINDER_FLOOR_MS);
    }
  });

  it('to samo „teraz” daje ten sam wynik', () => {
    expect(planDemoBookings(NOW)).toEqual(planDemoBookings(NOW));
  });

  it('w dniu wiosennej zmiany czasu godziny lokalne zostają godzinami lokalnymi', () => {
    // 2027-03-28 to niedziela zmiany czasu; seed odpalony dzień wcześniej planuje wizyty
    // po obu stronach przeskoku
    const bookings = planDemoBookings(new Date('2027-03-27T10:00:00.000Z'));

    for (const booking of bookings) {
      const expected = zonedWallClockToUtc(
        utcToLocalDate(booking.startsAt),
        booking.spec.startTime,
      );
      expect(booking.startsAt).toEqual(expected);
    }
  });

  it('trzyma się reguł przez cały rok uruchomień', () => {
    // Grafiki różnią się dniami tygodnia, a przesunięcia liczą dni robocze — kolizja albo
    // wyjście poza grafik może się ujawnić dopiero przy konkretnym dniu startu seeda.
    for (let day = 0; day < 366; day += 1) {
      const now = new Date(
        Date.UTC(2026, 7, 12, 9, 37) + day * 24 * 60 * MINUTE_MS,
      );
      const bookings = planDemoBookings(now);

      expect(bookings).toHaveLength(planDemoBookings(NOW).length);
      for (const booking of bookings) {
        const intervals = workIntervalsFor(
          employeeOf(booking),
          utcToLocalDate(booking.startsAt),
        );
        expect(
          fitsAnyInterval(booking.startsAt, booking.endsAt, intervals),
        ).toBe(true);

        if (PAST_STATUSES.includes(booking.spec.status)) {
          expect(booking.endsAt.getTime()).toBeLessThan(now.getTime());
        } else {
          expect(booking.startsAt.getTime()).toBeGreaterThan(now.getTime());
        }
      }
    }
  });
});

describe('planDemoTimeOffs', () => {
  it('urlop obejmuje pełne doby lokalne w przyszłości', () => {
    for (const timeOff of planDemoTimeOffs(NOW)) {
      expect(timeOff.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
      expect(timeOff.endsAt.getTime()).toBeGreaterThan(
        timeOff.startsAt.getTime(),
      );
      expect(utcToLocalDate(timeOff.startsAt).day).not.toBe(
        utcToLocalDate(NOW).day,
      );
    }
  });

  it('urlop wycina tyle dni pracy, ile deklaruje, niezależnie od dnia startu seeda', () => {
    // Liczone w dobach kalendarzowych urlop odpalony w piątek trafiłby na weekend i nie
    // zabrałby ani jednego dnia pracy — stąd przebieg po całym tygodniu startów.
    for (let day = 0; day < 7; day += 1) {
      const now = new Date(NOW.getTime() + day * 24 * 60 * MINUTE_MS);

      for (const timeOff of planDemoTimeOffs(now)) {
        const employee = employeeIn(
          timeOff.spec.businessSlug,
          timeOff.spec.employeeName,
        );

        let workdays = 0;
        for (
          let cursor = timeOff.startsAt.getTime();
          cursor < timeOff.endsAt.getTime();
          cursor += 24 * 60 * MINUTE_MS
        ) {
          const intervals = workIntervalsFor(
            employee,
            utcToLocalDate(new Date(cursor)),
          );
          if (intervals.length > 0) {
            workdays += 1;
          }
        }

        expect(workdays).toBe(timeOff.spec.workdays);
      }
    }
  });
});
