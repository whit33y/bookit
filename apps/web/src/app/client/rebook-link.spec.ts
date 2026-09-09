import { rebookFrom, rebookQueryParams } from './rebook-link';

/** Wrzesień 2026, południe — z dala od północy, żeby strefa firmy nie przesunęła daty. */
const NOW = new Date('2026-09-09T12:00:00.000Z');

const visit = (status: string, startsAt: string, rebookEmployeeId: string | null = 'e1') => ({
  startsAt,
  status,
  service: { id: 's1' },
  rebookEmployeeId,
});

describe('rebookFrom', () => {
  it('zakończona wizyta z wczoraj: termin + miesiąc', () => {
    const from = rebookFrom(visit('COMPLETED', '2026-09-08T10:00:00.000Z'), NOW);

    expect(from).toBe('2026-10-08');
  });

  it('zakończona wizyta sprzed pół roku: miesiąc po niej już minął, więc dziś + tydzień', () => {
    const from = rebookFrom(visit('COMPLETED', '2026-03-10T10:00:00.000Z'), NOW);

    expect(from).toBe('2026-09-16');
  });

  it('odwołana wizyta z minionym terminem: termin + tydzień', () => {
    const from = rebookFrom(
      visit('CANCELLED_BY_CLIENT', '2026-09-06T10:00:00.000Z'),
      NOW,
    );

    expect(from).toBe('2026-09-13');
  });

  it('odwołana wizyta z archiwum: tydzień po niej też minął, więc dziś + tydzień', () => {
    const from = rebookFrom(
      visit('CANCELLED_BY_CLIENT', '2026-08-26T10:00:00.000Z'),
      NOW,
    );

    expect(from).toBe('2026-09-16');
  });

  it('odwołana wizyta z terminem jutro: dziś — to przekładanie, nie kolejny cykl', () => {
    const from = rebookFrom(
      visit('CANCELLED_BY_BUSINESS', '2026-09-10T10:00:00.000Z'),
      NOW,
    );

    expect(from).toBe('2026-09-09');
  });

  it('liczy w strefie firmy, nie UTC: wizyta o 23:30 czasu Warszawy należy do swojego dnia', () => {
    // 2026-09-08T21:30Z to 8 września 23:30 w Warszawie — po UTC wyszedłby 8, po dacie
    // lokalnej też 8; kontrolna jest godzina 22:30Z, która w Warszawie jest już 9 września
    const from = rebookFrom(visit('COMPLETED', '2026-09-08T22:30:00.000Z'), NOW);

    expect(from).toBe('2026-10-09');
  });

  it('przycina dzień do długości miesiąca docelowego: 31 stycznia + miesiąc to 28 lutego', () => {
    const from = rebookFrom(
      visit('COMPLETED', '2026-01-31T10:00:00.000Z'),
      new Date('2026-01-31T12:00:00.000Z'),
    );

    expect(from).toBe('2026-02-28');
  });
});

describe('rebookQueryParams', () => {
  it('niesie usługę, pracownika i punkt startowy', () => {
    const params = rebookQueryParams(
      visit('COMPLETED', '2026-09-08T10:00:00.000Z'),
      NOW,
    );

    expect(params).toEqual({
      serviceId: 's1',
      employeeId: 'e1',
      rebookFrom: '2026-10-08',
    });
  });

  it('pracownik zniknął: dowolny plus flaga, po której kreator pozna degradację wyboru', () => {
    const params = rebookQueryParams(
      visit('COMPLETED', '2026-09-08T10:00:00.000Z', null),
      NOW,
    );

    expect(params.employeeId).toBe('any');
    expect(params.rebookEmployeeGone).toBe('1');
  });

  it('bez flagi, gdy pracownik został: „dowolny" ma znaczyć wybór klienta', () => {
    const params = rebookQueryParams(
      visit('COMPLETED', '2026-09-08T10:00:00.000Z'),
      NOW,
    );

    expect(params.rebookEmployeeGone).toBeUndefined();
  });
});
