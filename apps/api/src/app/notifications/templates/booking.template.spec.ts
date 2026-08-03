import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { BookingEventData } from './booking-event';
import { renderBookingEmail } from './booking.template';

const APP_URL = 'http://localhost:4200';

// Intl wstawia NBSP przed „zł" i w tysiącach — porównania robimy na znormalizowanym tekście
const normalize = (value: string) => value.replace(/\u00a0/g, ' ');

const data = (overrides: Partial<BookingEventData> = {}): BookingEventData => ({
  // zimowa środa: 08:00Z = 09:00 lokalnie (CET)
  startsAt: new Date('2026-01-14T08:00:00.000Z'),
  endsAt: new Date('2026-01-14T09:00:00.000Z'),
  clientNote: null,
  client: { firstName: 'Jan', lastName: 'Kowalski', phone: '500100200' },
  business: {
    name: 'Salon Ola',
    slug: 'salon-ola',
    street: 'ul. Kwiatowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    phone: '221234567',
  },
  service: { name: 'Strzyżenie damskie', durationMin: 60, priceCents: 12000 },
  employee: { name: 'Ola' },
  ...overrides,
});

describe('renderBookingEmail', () => {
  it('COMPLETED i PENDING nie mają maila — render zgodny z routingiem', () => {
    expect(renderBookingEmail(BookingStatus.COMPLETED, data(), APP_URL)).toBeNull();
    expect(renderBookingEmail(BookingStatus.PENDING, data(), APP_URL)).toBeNull();
  });

  it('CONFIRMED: temat i treść po polsku, z danymi wizyty i firmy', () => {
    const mail = renderBookingEmail(BookingStatus.CONFIRMED, data(), APP_URL);

    expect(normalize(mail?.subject ?? '')).toBe(
      'Rezerwacja potwierdzona: Salon Ola — środa, 14 stycznia 2026, 09:00–10:00',
    );
    const text = normalize(mail?.text ?? '');
    expect(text).toContain('Rezerwacja potwierdzona');
    expect(text).toContain('Cześć Jan');
    expect(text).toContain('Usługa: Strzyżenie damskie (60 min)');
    expect(text).toContain('Pracownik: Ola');
    expect(text).toContain('Cena: 120,00 zł');
    expect(text).toContain('Adres: ul. Kwiatowa 1, 00-001 Warszawa');
    // klient dostaje link do swoich wizyt
    expect(text).toContain(`${APP_URL}/client`);
  });

  it('godzina liczona w Europe/Warsaw — ten sam offset UTC daje inną porę lato/zima', () => {
    const winter = renderBookingEmail(BookingStatus.CONFIRMED, data(), APP_URL);
    const summer = renderBookingEmail(
      BookingStatus.CONFIRMED,
      data({
        startsAt: new Date('2026-07-14T08:00:00.000Z'),
        endsAt: new Date('2026-07-14T09:00:00.000Z'),
      }),
      APP_URL,
    );

    expect(winter?.text).toContain('09:00–10:00');
    expect(summer?.text).toContain('10:00–11:00');
    expect(summer?.text).toContain('14 lipca 2026');
  });

  it('CANCELLED_BY_CLIENT: mail dla firmy — dane klienta i notatka zamiast adresu firmy', () => {
    const mail = renderBookingEmail(
      BookingStatus.CANCELLED_BY_CLIENT,
      data({ clientNote: 'Proszę o kolor ciemny' }),
      APP_URL,
    );

    const text = normalize(mail?.text ?? '');
    expect(mail?.subject).toContain('Klient odwołał rezerwację');
    expect(text).toContain('Klient: Jan Kowalski');
    expect(text).toContain('Telefon: 500100200');
    expect(text).toContain('Notatka: Proszę o kolor ciemny');
    expect(text).not.toContain('Adres:');
    expect(text).toContain(`${APP_URL}/business/calendar`);
  });

  it('CREATED: mail dla firmy z linkiem do oczekujących rezerwacji', () => {
    const mail = renderBookingEmail('CREATED', data(), APP_URL);

    expect(mail?.subject).toContain('Nowa rezerwacja');
    expect(mail?.text).toContain('Klient Jan Kowalski');
    expect(mail?.text).toContain(`${APP_URL}/business/pending`);
  });

  it('REMINDER: przypomnienie dla klienta z pełnymi danymi wizyty', () => {
    const mail = renderBookingEmail('REMINDER', data(), APP_URL);

    expect(normalize(mail?.subject ?? '')).toBe(
      'Przypomnienie o wizycie: Salon Ola — środa, 14 stycznia 2026, 09:00–10:00',
    );
    const text = normalize(mail?.text ?? '');
    expect(text).toContain('Przypomnienie o wizycie');
    expect(text).toContain('Cześć Jan');
    expect(text).toContain('Adres: ul. Kwiatowa 1, 00-001 Warszawa');
    expect(text).toContain(`${APP_URL}/client`);
    // Termin wprost w treści, nie „jutro": okno crona nadgania rezerwacje potwierdzone późno,
    // więc mail może wyjść tego samego dnia.
    expect(text).toContain('środa, 14 stycznia 2026, 09:00–10:00');
    expect(text).not.toContain('jutr');
    // CTA nie obiecuje odwołania — przy cancellationHours = 24 okno mija w momencie wysyłki
    expect(text).not.toContain('odwołaj');
    // obie wersje treści, tak jak pozostałe zdarzenia
    expect(mail?.html).toContain('<h2');
  });

  it('DECLINED i CANCELLED_BY_BUSINESS mają rozróżnialne treści dla klienta', () => {
    const declined = renderBookingEmail(BookingStatus.DECLINED, data(), APP_URL);
    const cancelled = renderBookingEmail(
      BookingStatus.CANCELLED_BY_BUSINESS,
      data(),
      APP_URL,
    );

    expect(declined?.text).toContain('nie może przyjąć');
    expect(cancelled?.text).toContain('odwołała Twoją wizytę');
    expect(declined?.subject).not.toBe(cancelled?.subject);
    // „Wybierz inny termin" musi prowadzić tam, gdzie termin da się wybrać — na profil
    // firmy, nie na listę własnych wizyt
    expect(declined?.text).toContain(`${APP_URL}/salon-ola`);
    expect(cancelled?.text).toContain(`${APP_URL}/client`);
  });

  it('braki opcjonalnych danych nie zostawiają pustych wierszy', () => {
    const mail = renderBookingEmail(
      BookingStatus.CONFIRMED,
      data({
        business: {
          name: 'Salon Ola',
          slug: 'salon-ola',
          street: 'ul. Kwiatowa 1',
          city: 'Warszawa',
          postalCode: null,
          phone: null,
        },
      }),
      APP_URL,
    );

    expect(mail?.text).toContain('Adres: ul. Kwiatowa 1, Warszawa');
    expect(mail?.text).not.toContain('Telefon:');
  });

  it('wolny tekst jest escapowany w HTML, ale nie w wersji tekstowej', () => {
    const mail = renderBookingEmail(
      BookingStatus.CANCELLED_BY_CLIENT,
      data({ clientNote: '<script>alert("x")</script>' }),
      APP_URL,
    );

    expect(mail?.html).not.toContain('<script>');
    expect(mail?.html).toContain('&lt;script&gt;');
    expect(mail?.text).toContain('<script>alert("x")</script>');
  });

  it('HTML i tekst niosą tę samą treść — obie wersje są wypełnione', () => {
    const mail = renderBookingEmail(BookingStatus.CONFIRMED, data(), APP_URL);

    expect(mail?.html).toContain('<h2');
    expect(mail?.html).toContain('Strzyżenie damskie');
    expect(mail?.html).toContain(`href="${APP_URL}/client"`);
    expect(mail?.text).not.toContain('<h2');
  });
});
