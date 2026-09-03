import { BookingStatus, NotificationType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { BookingEventData } from './booking-event';
import {
  renderBookingNotification,
  renderBusinessApplicationNotification,
} from './notification.template';

const BOOKING_ID = 'b1';

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

describe('renderBookingNotification', () => {
  it('CONFIRMED: typ, treść dla klienta i deep-link do jego wizyt', () => {
    const notification = renderBookingNotification(
      BookingStatus.CONFIRMED,
      BOOKING_ID,
      data(),
    );

    expect(notification?.type).toBe(NotificationType.BOOKING_CONFIRMED);
    expect(notification?.title).toBe('Rezerwacja potwierdzona');
    // nazwa firmy nigdy nie stoi przed czasownikiem — rodzaj niesie rzeczownik „Firma"
    expect(notification?.body ?? '').toBe(
      'Firma Salon Ola potwierdziła wizytę Strzyżenie damskie — środa, 14 stycznia 2026, 09:00–10:00.',
    );
    expect(notification?.url).toBe('/client?booking=b1');
  });

  it('CREATED: powiadomienie firmy prowadzi do kalendarza na dzień wizyty', () => {
    const notification = renderBookingNotification('CREATED', BOOKING_ID, data());

    expect(notification?.type).toBe(NotificationType.BOOKING_CREATED);
    expect(notification?.title).toBe('Nowa rezerwacja czeka na decyzję');
    // imię klienta po rzeczowniku, nie przed czasownikiem („Kinga Nowak odwołał")
    expect(notification?.body).toContain('Klient: Jan Kowalski');
    expect(notification?.url).toBe(
      '/business/calendar?date=2026-01-14&booking=b1',
    );
  });

  it('CANCELLED_BY_CLIENT: odbiorcą jest firma, więc link idzie do kalendarza', () => {
    const notification = renderBookingNotification(
      BookingStatus.CANCELLED_BY_CLIENT,
      BOOKING_ID,
      data(),
    );

    expect(notification?.type).toBe(NotificationType.BOOKING_CANCELLED_BY_CLIENT);
    expect(notification?.body).toContain('Termin jest znowu wolny');
    expect(notification?.url).toContain('/business/calendar?date=2026-01-14');
  });

  it('data w linku firmy to doba lokalna, nie UTC', () => {
    // 22:30Z = 00:30 czasu polskiego już 15 lipca; toISOString().slice(0, 10) dałby tu
    // 2026-07-14 i kalendarz otworzyłby się na dniu bez tej wizyty — regresja na strefę
    const notification = renderBookingNotification('CREATED', BOOKING_ID, {
      ...data(),
      startsAt: new Date('2026-07-14T22:30:00.000Z'),
      endsAt: new Date('2026-07-14T23:30:00.000Z'),
    });

    expect(notification?.url).toBe('/business/calendar?date=2026-07-15&booking=b1');
  });

  it('REMINDER: przypomnienie dla klienta z nazwą firmy i terminem', () => {
    const notification = renderBookingNotification('REMINDER', BOOKING_ID, data());

    expect(notification?.type).toBe(NotificationType.BOOKING_REMINDER);
    expect(notification?.title).toBe('Przypomnienie o wizycie');
    expect(notification?.body ?? '').toContain(
      'środa, 14 stycznia 2026, 09:00–10:00',
    );
    expect(notification?.url).toBe('/client?booking=b1');
  });

  it('DECLINED i CANCELLED_BY_BUSINESS mają rozróżnialne typy i treści', () => {
    const declined = renderBookingNotification(
      BookingStatus.DECLINED,
      BOOKING_ID,
      data(),
    );
    const cancelled = renderBookingNotification(
      BookingStatus.CANCELLED_BY_BUSINESS,
      BOOKING_ID,
      data(),
    );

    expect(declined?.type).toBe(NotificationType.BOOKING_DECLINED);
    expect(cancelled?.type).toBe(NotificationType.BOOKING_CANCELLED_BY_BUSINESS);
    expect(declined?.body).toContain('nie może przyjąć');
    expect(cancelled?.body).toContain('odwołała wizytę');
  });

  it('zdarzenia bez adresata nie mają powiadomienia', () => {
    expect(
      renderBookingNotification(BookingStatus.COMPLETED, BOOKING_ID, data()),
    ).toBeNull();
    expect(
      renderBookingNotification(BookingStatus.PENDING, BOOKING_ID, data()),
    ).toBeNull();
  });
});

describe('renderBusinessApplicationNotification', () => {
  const application = { name: 'Salon Ola', rejectionReason: null, owner: { firstName: 'Ola' } };

  it('obie decyzje prowadzą na formularz zgłoszenia', () => {
    expect(renderBusinessApplicationNotification('APPROVED', application)).toMatchObject({
      type: NotificationType.BUSINESS_APPROVED,
      url: '/create-business',
    });
    expect(renderBusinessApplicationNotification('REJECTED', application)).toMatchObject({
      type: NotificationType.BUSINESS_REJECTED,
      url: '/create-business',
    });
  });

  it('nazwa firmy nie stoi przed czasownikiem — rodzaj niesie rzeczownik przed nią', () => {
    const approved = renderBusinessApplicationNotification('APPROVED', application);
    const rejected = renderBusinessApplicationNotification('REJECTED', application);

    expect(approved.body).toContain('Firma Salon Ola');
    expect(rejected.body).toContain('Zgłoszenie firmy Salon Ola');
  });
});
