import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { depositOutcome } from './refund-policy';

describe('depositOutcome', () => {
  describe('odwołanie przez firmę → zawsze zwrot', () => {
    // „refund automatyczny przy każdym odwołaniu przez firmę" — termin nie ma tu nic
    // do rzeczy, bo to nie klient rozmyślił się za późno
    it.each([true, false])(
      'CANCELLED_BY_BUSINESS zwraca niezależnie od terminu (withinWindow=%s)',
      (withinWindow) => {
        expect(
          depositOutcome(BookingStatus.CANCELLED_BY_BUSINESS, withinWindow),
        ).toBe('REFUND');
      },
    );

    it.each([true, false])(
      'DECLINED zwraca niezależnie od terminu (withinWindow=%s)',
      (withinWindow) => {
        expect(depositOutcome(BookingStatus.DECLINED, withinWindow)).toBe(
          'REFUND',
        );
      },
    );
  });

  describe('odwołanie przez klienta → decyduje termin', () => {
    it('w terminie → zwrot', () => {
      expect(depositOutcome(BookingStatus.CANCELLED_BY_CLIENT, true)).toBe(
        'REFUND',
      );
    });

    it('po terminie → zaliczka przepada', () => {
      expect(depositOutcome(BookingStatus.CANCELLED_BY_CLIENT, false)).toBe(
        'FORFEIT',
      );
    });
  });

  describe('przejścia, które nie ruszają pieniędzy', () => {
    it.each([BookingStatus.CONFIRMED, BookingStatus.COMPLETED])(
      '%s → NONE',
      (to) => {
        expect(depositOutcome(to, true)).toBe('NONE');
        expect(depositOutcome(to, false)).toBe('NONE');
      },
    );
  });
});
