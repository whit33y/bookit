import {
  addDays,
  bookingGridRow,
  formatDayLabel,
  minutesSinceMidnight,
  rangeForView,
  startOfWeekMonday,
  weekDays,
} from './calendar-date';

describe('addDays', () => {
  it('dodaje dni w obrębie miesiąca', () => {
    expect(addDays('2026-08-10', 3)).toBe('2026-08-13');
  });

  it('przechodzi przez koniec miesiąca', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });

  it('przechodzi przez koniec roku', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('liczba ujemna cofa datę', () => {
    expect(addDays('2026-08-10', -3)).toBe('2026-08-07');
  });
});

describe('startOfWeekMonday', () => {
  it('dla środy zwraca poniedziałek tego samego tygodnia', () => {
    // 2026-08-12 to środa
    expect(startOfWeekMonday('2026-08-12')).toBe('2026-08-10');
  });

  it('dla niedzieli zwraca poniedziałek tego samego tygodnia (nie następnego)', () => {
    // 2026-08-16 to niedziela
    expect(startOfWeekMonday('2026-08-16')).toBe('2026-08-10');
  });

  it('dla poniedziałku zwraca siebie', () => {
    expect(startOfWeekMonday('2026-08-10')).toBe('2026-08-10');
  });
});

describe('weekDays', () => {
  it('zwraca 7 kolejnych dni zaczynając od poniedziałku', () => {
    expect(weekDays('2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });
});

describe('rangeForView', () => {
  it('dzień: from === to === anchor', () => {
    expect(rangeForView('day', '2026-08-12')).toEqual({
      from: '2026-08-12',
      to: '2026-08-12',
    });
  });

  it('tydzień: from = poniedziałek, to = niedziela', () => {
    expect(rangeForView('week', '2026-08-12')).toEqual({
      from: '2026-08-10',
      to: '2026-08-16',
    });
  });
});

describe('minutesSinceMidnight', () => {
  it('konwertuje ISO UTC na minuty czasu firmy — zima, offset +1h', () => {
    // 10:00 UTC w styczniu = 11:00 w Warszawie (CET, +1h)
    expect(minutesSinceMidnight('2026-01-15T10:00:00Z')).toBe(11 * 60);
  });

  it('konwertuje ISO UTC na minuty czasu firmy — lato, offset +2h (DST)', () => {
    // 10:00 UTC w lipcu = 12:00 w Warszawie (CEST, +2h)
    expect(minutesSinceMidnight('2026-07-15T10:00:00Z')).toBe(12 * 60);
  });
});

describe('bookingGridRow', () => {
  it('rezerwacja w środku okna (09:00–09:30)', () => {
    expect(
      bookingGridRow('2026-01-15T08:00:00Z', '2026-01-15T08:30:00Z'),
    ).toEqual({ rowStart: 2 + (9 * 60 - 7 * 60) / 15, rowEnd: 2 + (9 * 60 - 7 * 60) / 15 + 2 });
  });

  it('rezerwacja zaczynająca się przed oknem (06:00) jest przycięta do początku', () => {
    const { rowStart } = bookingGridRow(
      '2026-01-15T05:00:00Z', // 06:00 w Warszawie
      '2026-01-15T07:00:00Z', // 08:00 w Warszawie
    );
    expect(rowStart).toBe(2);
  });

  it('rezerwacja w całości przed oknem (05:00–06:00) nie jest mylona z przejściem przez północ', () => {
    // regresja: porównanie „koniec <= start" musi iść po surowym starcie (05:00), nie po
    // starcie przyciętym do 07:00 — inaczej koniec wypada na 21:00 zamiast na 07:00
    const { rowStart, rowEnd } = bookingGridRow(
      '2026-01-15T04:00:00Z', // 05:00 w Warszawie
      '2026-01-15T05:00:00Z', // 06:00 w Warszawie
    );
    // cała rezerwacja mieści się przed oknem — przycięta do jednowierszowej „kreski" na górze,
    // a nie rozciągnięta do końca siatki (21:00), jak przy błędnym wykrywaniu północy
    expect(rowStart).toBe(2);
    expect(rowEnd).toBe(3);
  });

  it('rezerwacja kończąca się po oknie (21:30) jest przycięta do końca', () => {
    const { rowStart, rowEnd } = bookingGridRow(
      '2026-01-15T19:00:00Z', // 20:00 w Warszawie
      '2026-01-15T20:30:00Z', // 21:30 w Warszawie
    );
    // (07:00–21:00) / 15 min = 56 slotów, wiersz 1 to nagłówek → ostatni wiersz to 2+56
    expect(rowEnd).toBe(2 + 56);
    expect(rowStart).toBeLessThan(rowEnd);
  });

  it('rezerwacja krótsza niż jeden slot (10 min) ma span minimum 1', () => {
    const { rowStart, rowEnd } = bookingGridRow(
      '2026-01-15T08:00:00Z',
      '2026-01-15T08:10:00Z',
    );
    expect(rowEnd - rowStart).toBe(1);
  });
});

describe('formatDayLabel', () => {
  it('zawiera skrócony polski dzień tygodnia i numer dnia', () => {
    const label = formatDayLabel('2026-08-12');
    expect(label).toContain('12');
    expect(label.toLowerCase()).toContain('śr');
  });
});
