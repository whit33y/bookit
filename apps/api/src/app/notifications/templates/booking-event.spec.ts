import { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { BOOKING_EVENT_RECIPIENT } from './booking-event';

// Routing jest wspólny dla maila (#37) i powiadomień in-app (#54) — testujemy go raz,
// tutaj, a specs kanałów sprawdzają już tylko własne treści.
describe('BOOKING_EVENT_RECIPIENT', () => {
  it('zdarzenia klienta idą do klienta, odwołanie klienta do firmy', () => {
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.CONFIRMED]).toBe('CLIENT');
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.DECLINED]).toBe('CLIENT');
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.CANCELLED_BY_BUSINESS]).toBe('CLIENT');
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.CANCELLED_BY_CLIENT]).toBe('BUSINESS');
    expect(BOOKING_EVENT_RECIPIENT.CREATED).toBe('BUSINESS');
    // przypomnienie z crona (#38) — firma ma wizytę w kalendarzu, przypomina się klientowi
    expect(BOOKING_EVENT_RECIPIENT.REMINDER).toBe('CLIENT');
  });

  it('COMPLETED i PENDING nie mają adresata', () => {
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.COMPLETED]).toBeNull();
    expect(BOOKING_EVENT_RECIPIENT[BookingStatus.PENDING]).toBeNull();
  });
});
