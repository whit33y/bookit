import { describe, expect, it } from 'vitest';
import { parseLocalDate, zonedWallClockToUtc } from './business-time';
import {
  BusyInterval,
  fitsAnyInterval,
  generateSlots,
  overlapsAny,
} from './slots.util';

const at = (iso: string) => new Date(iso);
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());
// Array.prototype.at jest poza lib es2020 z tsconfig.base
const last = (values: string[]) => values[values.length - 1];

// zimowy dzień (CET, +1): 09:00 lokalnie = 08:00Z — łatwo czytać oczekiwania
const PAST = at('2020-01-01T00:00:00.000Z');

// przedział pracy z lokalnych "HH:mm" danego dnia — tak samo jak robi to serwis
const interval = (date: string, startTime: string, endTime: string) => {
  const day = parseLocalDate(date);
  return {
    startUtc: zonedWallClockToUtc(day, startTime),
    endUtc: zonedWallClockToUtc(day, endTime),
  };
};

const busy = (startsAt: string, endsAt: string): BusyInterval => ({
  startsAt: at(startsAt),
  endsAt: at(endsAt),
});

describe('generateSlots', () => {
  it('wiele przedziałów w dniu (9–13, 15–19): sloty z obu, luka pusta', () => {
    const slots = iso(
      generateSlots({
        intervals: [
          interval('2026-01-15', '09:00', '13:00'),
          interval('2026-01-15', '15:00', '19:00'),
        ],
        busy: [],
        durationMin: 60,
        notBefore: PAST,
      }),
    );

    expect(slots[0]).toBe('2026-01-15T08:00:00.000Z'); // 09:00 lokalnie
    expect(slots).toContain('2026-01-15T11:00:00.000Z'); // 12:00 — ostatni z 1. przedziału
    expect(slots).not.toContain('2026-01-15T11:15:00.000Z'); // 12:15 — nie zmieści się do 13:00
    expect(slots).not.toContain('2026-01-15T12:00:00.000Z'); // 13:00 — luka między przedziałami
    expect(slots).toContain('2026-01-15T14:00:00.000Z'); // 15:00 — start 2. przedziału
    expect(last(slots)).toBe('2026-01-15T17:00:00.000Z'); // 18:00 — ostatni z 2. przedziału
    // 2 przedziały × 4 h, usługa 60 min → po 13 startów w każdym
    expect(slots).toHaveLength(26);
  });

  it('slot nie wychodzi za koniec przedziału (9–13, usługa 90 min → ostatni start 11:30)', () => {
    const slots = iso(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '13:00')],
        busy: [],
        durationMin: 90,
        notBefore: PAST,
      }),
    );

    expect(last(slots)).toBe('2026-01-15T10:30:00.000Z'); // 11:30 lokalnie
  });

  it('sloty leżą na siatce 15 min, nawet gdy przedział startuje o 09:07', () => {
    const slots = iso(
      generateSlots({
        intervals: [interval('2026-01-15', '09:07', '12:00')],
        busy: [],
        durationMin: 60,
        notBefore: PAST,
      }),
    );

    expect(slots[0]).toBe('2026-01-15T08:15:00.000Z'); // 09:15 lokalnie
    expect(slots.every((s) => [0, 15, 30, 45].includes(new Date(s).getUTCMinutes()))).toBe(true);
  });

  it('rezerwacja na granicy slotu: 10:00–10:30 blokuje 10:15, ale nie 10:30', () => {
    const slots = iso(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '13:00')],
        // 10:00–10:30 lokalnie
        busy: [busy('2026-01-15T09:00:00.000Z', '2026-01-15T09:30:00.000Z')],
        durationMin: 30,
        notBefore: PAST,
      }),
    );

    expect(slots).toContain('2026-01-15T09:30:00.000Z'); // 10:30 — styk, nie kolizja
    expect(slots).toContain('2026-01-15T08:30:00.000Z'); // 09:30–10:00 — styk z drugiej strony
    expect(slots).not.toContain('2026-01-15T09:00:00.000Z'); // 10:00 — dokładnie zajęte
    expect(slots).not.toContain('2026-01-15T09:15:00.000Z'); // 10:15 — nachodzi końcem
    expect(slots).not.toContain('2026-01-15T08:45:00.000Z'); // 09:45 — nachodzi początkiem
  });

  it('urlop częściowo nachodzący na przedział wycina tylko nachodzące sloty', () => {
    const slots = iso(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '13:00')],
        // urlop 07:00–11:00 lokalnie: zaczyna się przed grafikiem, kończy w jego środku
        busy: [busy('2026-01-15T06:00:00.000Z', '2026-01-15T10:00:00.000Z')],
        durationMin: 60,
        notBefore: PAST,
      }),
    );

    expect(slots[0]).toBe('2026-01-15T10:00:00.000Z'); // 11:00 — pierwszy po urlopie
    expect(last(slots)).toBe('2026-01-15T11:00:00.000Z'); // 12:00
    expect(slots).toHaveLength(5);
  });

  it('urlop obejmujący cały przedział → brak slotów', () => {
    expect(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '13:00')],
        busy: [busy('2026-01-14T00:00:00.000Z', '2026-01-16T00:00:00.000Z')],
        durationMin: 60,
        notBefore: PAST,
      }),
    ).toEqual([]);
  });

  it('sloty w przeszłości są odfiltrowane, slot startujący dokładnie „teraz" zostaje', () => {
    const slots = iso(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '13:00')],
        busy: [],
        durationMin: 60,
        notBefore: at('2026-01-15T10:00:00.000Z'), // 11:00 lokalnie
      }),
    );

    expect(slots).toEqual([
      '2026-01-15T10:00:00.000Z',
      '2026-01-15T10:15:00.000Z',
      '2026-01-15T10:30:00.000Z',
      '2026-01-15T10:45:00.000Z',
      '2026-01-15T11:00:00.000Z',
    ]);
  });

  it('usługa dłuższa niż przedział pracy → brak slotów', () => {
    expect(
      generateSlots({
        intervals: [interval('2026-01-15', '09:00', '10:00')],
        busy: [],
        durationMin: 120,
        notBefore: PAST,
      }),
    ).toEqual([]);
  });

  describe('zmiana czasu', () => {
    // przedział 00:00–06:00, usługa 60 min — celowo obejmuje godzinę zmiany czasu (03:00 lokalnie)
    const nightSlots = (date: string) =>
      iso(
        generateSlots({
          intervals: [interval(date, '00:00', '06:00')],
          busy: [],
          durationMin: 60,
          notBefore: PAST,
        }),
      );

    it('zwykła doba: 6 h przedziału → 21 startów', () => {
      expect(nightSlots('2026-03-22')).toHaveLength(21);
    });

    it('wiosenna zmiana: doba krótsza o godzinę → 4 slotów mniej, brak slotu w 02:00 lokalnie', () => {
      const slots = nightSlots('2026-03-29');

      expect(slots).toHaveLength(17);
      expect(slots[0]).toBe('2026-03-28T23:00:00.000Z'); // 00:00 lokalnie (CET)
      // 01:45 lokalnie → następny start to 03:00 lokalnie: nieistniejąca godzina wypada sama
      expect(slots).toContain('2026-03-29T00:45:00.000Z');
      expect(slots).toContain('2026-03-29T01:00:00.000Z');
      expect(last(slots)).toBe('2026-03-29T03:00:00.000Z'); // 05:00 lokalnie (CEST)
    });

    it('jesienna zmiana: doba dłuższa o godzinę → 4 sloty więcej, powtórzona godzina ma sloty', () => {
      const slots = nightSlots('2026-10-25');

      expect(slots).toHaveLength(25);
      expect(slots[0]).toBe('2026-10-24T22:00:00.000Z'); // 00:00 lokalnie (CEST)
      // 02:00 lokalnie występuje dwa razy — oba wystąpienia to osobne, realne sloty
      expect(slots).toContain('2026-10-25T00:00:00.000Z'); // 02:00 CEST
      expect(slots).toContain('2026-10-25T01:00:00.000Z'); // 02:00 CET
      expect(last(slots)).toBe('2026-10-25T04:00:00.000Z'); // 05:00 lokalnie (CET)
    });

    // Ściana zegara z nieistniejącej godziny (02:00–02:59 w dniu wiosennej zmiany) mapuje się
    // o godzinę do przodu, więc 02:00 i 03:00 dają ten sam instant → przedział zdegenerowany.
    // Realnie nie do spotkania (grafik salonu na tę jedną noc w roku), ale nie może zawiesić pętli.
    it.each([
      ['02:00', '03:00'], // startUtc == endUtc
      ['02:45', '03:00'], // endUtc < startUtc
    ])('grafik %s–%s w luce wiosennej zmiany → brak slotów, bez zawieszenia', (from, to) => {
      expect(
        generateSlots({
          intervals: [interval('2026-03-29', from, to)],
          busy: [],
          durationMin: 30,
          notBefore: PAST,
        }),
      ).toEqual([]);
    });

    it('grafik 09:00–17:00 daje te same lokalne godziny zimą i latem', () => {
      const winter = iso(
        generateSlots({
          intervals: [interval('2026-01-15', '09:00', '17:00')],
          busy: [],
          durationMin: 60,
          notBefore: PAST,
        }),
      );
      const summer = iso(
        generateSlots({
          intervals: [interval('2026-07-15', '09:00', '17:00')],
          busy: [],
          durationMin: 60,
          notBefore: PAST,
        }),
      );

      expect(winter).toHaveLength(summer.length);
      expect(winter[0]).toBe('2026-01-15T08:00:00.000Z'); // 09:00 CET
      expect(summer[0]).toBe('2026-07-15T07:00:00.000Z'); // 09:00 CEST
    });
  });
});

// wspólne z re-walidacją slotu w BookingsService, więc testowane osobno od generateSlots
describe('overlapsAny', () => {
  const slot = [at('2026-01-15T10:00:00.000Z'), at('2026-01-15T11:00:00.000Z')] as const;
  const check = (busyList: BusyInterval[]) => overlapsAny(slot[0], slot[1], busyList);

  it('brak zajętych przedziałów → false', () => {
    expect(check([])).toBe(false);
  });

  it('styk na granicy nie jest kolizją', () => {
    expect(check([busy('2026-01-15T09:00:00.000Z', '2026-01-15T10:00:00.000Z')])).toBe(false);
    expect(check([busy('2026-01-15T11:00:00.000Z', '2026-01-15T12:00:00.000Z')])).toBe(false);
  });

  it.each([
    ['nachodzi początkiem', '2026-01-15T09:30:00.000Z', '2026-01-15T10:30:00.000Z'],
    ['nachodzi końcem', '2026-01-15T10:30:00.000Z', '2026-01-15T11:30:00.000Z'],
    ['zawiera slot', '2026-01-15T08:00:00.000Z', '2026-01-15T20:00:00.000Z'],
    ['zawarty w slocie', '2026-01-15T10:15:00.000Z', '2026-01-15T10:30:00.000Z'],
  ])('%s → true', (_label, startsAt, endsAt) => {
    expect(check([busy(startsAt, endsAt)])).toBe(true);
  });

  it('wystarczy jedna kolizja z wielu przedziałów', () => {
    expect(
      check([
        busy('2026-01-15T08:00:00.000Z', '2026-01-15T09:00:00.000Z'),
        busy('2026-01-15T10:45:00.000Z', '2026-01-15T11:15:00.000Z'),
      ]),
    ).toBe(true);
  });
});

describe('fitsAnyInterval', () => {
  const work = [interval('2026-01-15', '09:00', '13:00')];
  // 09:00–13:00 CET = 08:00–12:00Z
  const fits = (startIso: string, endIso: string) =>
    fitsAnyInterval(at(startIso), at(endIso), work);

  it('slot w środku przedziału → true', () => {
    expect(fits('2026-01-15T09:00:00.000Z', '2026-01-15T10:00:00.000Z')).toBe(true);
  });

  it('slot dokładnie na granicach przedziału → true', () => {
    expect(fits('2026-01-15T08:00:00.000Z', '2026-01-15T12:00:00.000Z')).toBe(true);
  });

  it('koniec za końcem przedziału → false', () => {
    expect(fits('2026-01-15T11:30:00.000Z', '2026-01-15T12:30:00.000Z')).toBe(false);
  });

  it('początek przed początkiem przedziału → false', () => {
    expect(fits('2026-01-15T07:30:00.000Z', '2026-01-15T08:30:00.000Z')).toBe(false);
  });

  it('brak przedziałów pracy → false', () => {
    expect(
      fitsAnyInterval(
        at('2026-01-15T09:00:00.000Z'),
        at('2026-01-15T10:00:00.000Z'),
        [],
      ),
    ).toBe(false);
  });

  it('slot w przerwie między dwoma przedziałami → false', () => {
    expect(
      fitsAnyInterval(
        at('2026-01-15T12:30:00.000Z'), // 13:30 lokalnie
        at('2026-01-15T13:30:00.000Z'),
        [interval('2026-01-15', '09:00', '13:00'), interval('2026-01-15', '15:00', '19:00')],
      ),
    ).toBe(false);
  });
});
