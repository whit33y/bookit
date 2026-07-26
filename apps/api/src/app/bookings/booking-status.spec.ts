import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS, STATUS_LABELS, canTransition } from './booking-status';

const ALL_STATUSES = Object.values(BookingStatus);

// krawędzie diagramu z SDD §7 — spisane ręcznie, żeby test był niezależnym
// odwzorowaniem dokumentacji, a nie kopią ALLOWED_TRANSITIONS
const EDGES: [BookingStatus, BookingStatus][] = [
  [BookingStatus.PENDING, BookingStatus.CONFIRMED],
  [BookingStatus.PENDING, BookingStatus.DECLINED],
  [BookingStatus.PENDING, BookingStatus.CANCELLED_BY_CLIENT],
  [BookingStatus.PENDING, BookingStatus.CANCELLED_BY_BUSINESS],
  [BookingStatus.CONFIRMED, BookingStatus.CANCELLED_BY_CLIENT],
  [BookingStatus.CONFIRMED, BookingStatus.CANCELLED_BY_BUSINESS],
  [BookingStatus.CONFIRMED, BookingStatus.COMPLETED],
];

const TERMINAL = [
  BookingStatus.DECLINED,
  BookingStatus.CANCELLED_BY_CLIENT,
  BookingStatus.CANCELLED_BY_BUSINESS,
  BookingStatus.COMPLETED,
];

describe('booking-status', () => {
  describe('canTransition', () => {
    it.each(EDGES)('%s → %s dozwolone', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    // dopełnienie EDGES: cokolwiek nie jest krawędzią diagramu, musi być zabronione
    const nonEdges = ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.filter(
        (to) => !EDGES.some(([f, t]) => f === from && t === to),
      ).map((to): [BookingStatus, BookingStatus] => [from, to]),
    );

    it.each(nonEdges)('%s → %s zabronione', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });

    it('przejście w miejscu jest zabronione dla każdego statusu', () => {
      // powtórny confirm ma dać 409, nie ciche 200
      for (const status of ALL_STATUSES) {
        expect(canTransition(status, status)).toBe(false);
      }
    });

    it('do CONFIRMED i DECLINED wchodzi się wyłącznie z PENDING', () => {
      for (const from of ALL_STATUSES) {
        const expected = from === BookingStatus.PENDING;
        expect(canTransition(from, BookingStatus.CONFIRMED)).toBe(expected);
        expect(canTransition(from, BookingStatus.DECLINED)).toBe(expected);
      }
    });
  });

  describe('ALLOWED_TRANSITIONS', () => {
    it.each(TERMINAL)('%s nie ma wyjść', (status) => {
      expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
    });

    it('każdy status ma wpis (kompletność mapy)', () => {
      for (const status of ALL_STATUSES) {
        expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
      }
    });
  });

  it('STATUS_LABELS pokrywa każdy status', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
