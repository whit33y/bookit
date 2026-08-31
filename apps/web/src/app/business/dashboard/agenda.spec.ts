import { describe, expect, it } from 'vitest';
import type { CalendarBooking } from '../calendar/booking-details-dialog';
import {
  AGENDA_LIMIT,
  agendaRange,
  todayVisitCount,
  upcomingAgenda,
} from './agenda';

// 12:00 czasu firmy (Europe/Warsaw, latem UTC+2) — środek dnia, żeby „przed" i „po" mieściły
// się w tej samej dobie kalendarzowej firmy
const NOW = Date.parse('2026-08-31T10:00:00.000Z');
const at = (iso: string) => Date.parse(iso);

function mkBooking(overrides: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1',
    startsAt: '2026-08-31T11:00:00.000Z',
    endsAt: '2026-08-31T11:30:00.000Z',
    status: 'CONFIRMED',
    clientNote: null,
    client: { firstName: 'Jan', lastName: 'Kowalski', phone: null },
    service: {
      id: 's1',
      name: 'Strzyżenie',
      description: null,
      durationMin: 30,
      priceCents: 8000,
    },
    employee: { id: 'e1', name: 'Ola' },
    ...overrides,
  };
}

const ids = (bookings: readonly CalendarBooking[]) => bookings.map((b) => b.id);

describe('agendaRange', () => {
  it('zaczyna się dziś w strefie firmy', () => {
    expect(agendaRange(NOW).from).toBe('2026-08-31');
  });

  it('sięga poza dzisiaj, żeby było czym wypełnić agendę po ostatniej dzisiejszej wizycie', () => {
    const { from, to } = agendaRange(NOW);

    expect(to > from).toBe(true);
  });

  it('bierze dzień z czasu firmy, nie z UTC — 23:30 w Warszawie to wciąż ten sam dzień', () => {
    expect(agendaRange(at('2026-08-31T21:30:00.000Z')).from).toBe('2026-08-31');
  });
});

describe('upcomingAgenda', () => {
  it('odcina wizyty od teraz, nie od początku dnia', () => {
    const bookings = [
      mkBooking({ id: 'rano', startsAt: '2026-08-31T07:00:00.000Z' }),
      mkBooking({ id: 'zaraz', startsAt: '2026-08-31T11:00:00.000Z' }),
    ];

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual(['zaraz']);
  });

  it('zostawia wizytę zaczynającą się dokładnie teraz', () => {
    const bookings = [
      mkBooking({ id: 'teraz', startsAt: '2026-08-31T10:00:00.000Z' }),
    ];

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual(['teraz']);
  });

  it('pokazuje wizyty z kolejnych dni, gdy dziś nic już nie zostało', () => {
    const bookings = [
      mkBooking({ id: 'wczoraj', startsAt: '2026-08-30T11:00:00.000Z' }),
      mkBooking({ id: 'jutro', startsAt: '2026-09-01T07:00:00.000Z' }),
    ];

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual(['jutro']);
  });

  it('sortuje rosnąco po terminie, niezależnie od kolejności z API', () => {
    const bookings = [
      mkBooking({ id: 'trzecia', startsAt: '2026-09-01T07:00:00.000Z' }),
      mkBooking({ id: 'pierwsza', startsAt: '2026-08-31T11:00:00.000Z' }),
      mkBooking({ id: 'druga', startsAt: '2026-08-31T14:00:00.000Z' }),
    ];

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual([
      'pierwsza',
      'druga',
      'trzecia',
    ]);
  });

  it(`zwraca najwyżej ${AGENDA_LIMIT} pozycje — i to te najbliższe`, () => {
    const bookings = Array.from({ length: 6 }, (_, i) =>
      mkBooking({
        id: `b${i}`,
        startsAt: `2026-08-31T1${i}:00:00.000Z`,
      }),
    );

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual(['b0', 'b1', 'b2']);
  });

  it('przepuszcza CONFIRMED i PENDING, odsiewa pozostałe statusy', () => {
    const bookings = [
      mkBooking({ id: 'confirmed', status: 'CONFIRMED' }),
      mkBooking({ id: 'pending', status: 'PENDING' }),
      mkBooking({ id: 'declined', status: 'DECLINED' }),
      mkBooking({ id: 'cancelledByClient', status: 'CANCELLED_BY_CLIENT' }),
      mkBooking({ id: 'cancelledByBusiness', status: 'CANCELLED_BY_BUSINESS' }),
      mkBooking({ id: 'completed', status: 'COMPLETED' }),
    ];

    expect(ids(upcomingAgenda(bookings, NOW))).toEqual([
      'confirmed',
      'pending',
    ]);
  });
});

describe('todayVisitCount', () => {
  it('liczy cały dzisiejszy dzień, także wizyty już odbyte', () => {
    const bookings = [
      mkBooking({ id: 'rano', startsAt: '2026-08-31T07:00:00.000Z' }),
      mkBooking({ id: 'po', startsAt: '2026-08-31T14:00:00.000Z' }),
    ];

    expect(todayVisitCount(bookings, NOW)).toBe(2);
  });

  it('nie liczy wizyt z innych dni', () => {
    const bookings = [
      mkBooking({ id: 'wczoraj', startsAt: '2026-08-30T11:00:00.000Z' }),
      mkBooking({ id: 'dziś', startsAt: '2026-08-31T11:00:00.000Z' }),
      mkBooking({ id: 'jutro', startsAt: '2026-09-01T11:00:00.000Z' }),
    ];

    expect(todayVisitCount(bookings, NOW)).toBe(1);
  });

  it('liczy tylko statusy nadchodzącej wizyty', () => {
    const bookings = [
      mkBooking({ id: 'confirmed', status: 'CONFIRMED' }),
      mkBooking({ id: 'pending', status: 'PENDING' }),
      mkBooking({ id: 'declined', status: 'DECLINED' }),
      mkBooking({ id: 'completed', status: 'COMPLETED' }),
    ];

    expect(todayVisitCount(bookings, NOW)).toBe(2);
  });

  it('przypisuje wizytę do dnia po czasie firmy — 22:00 UTC to już jutro w Warszawie', () => {
    const bookings = [mkBooking({ startsAt: '2026-08-31T22:00:00.000Z' })];

    expect(todayVisitCount(bookings, NOW)).toBe(0);
  });
});
