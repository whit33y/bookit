import { describe, expect, it } from 'vitest';
import {
  PAYMENT_CURRENCY,
  PAYMENT_TIMEOUT_MIN,
  expiryCutoff,
  isPaymentExpired,
  paymentDeadline,
} from './payment-window';

const CREATED_AT = new Date('2026-08-02T10:00:00.000Z');

describe('payment-window', () => {
  it('waluta zgadza się z domyślną wartością kolumny Payment.currency', () => {
    // Stripe wymaga małych liter, a schemat ma @default("pln") — rozjazd znaczyłby
    // PaymentIntenty w innej walucie niż zapisana w bazie kwota.
    expect(PAYMENT_CURRENCY).toBe('pln');
  });

  it('deadline to createdAt powiększone o timeout', () => {
    expect(paymentDeadline(CREATED_AT)).toEqual(
      new Date('2026-08-02T10:15:00.000Z'),
    );
    expect(PAYMENT_TIMEOUT_MIN).toBe(15);
  });

  it('nie modyfikuje daty wejściowej', () => {
    paymentDeadline(CREATED_AT);
    expect(CREATED_AT.toISOString()).toBe('2026-08-02T10:00:00.000Z');
  });

  it('płatność sprzed timeoutu jeszcze żyje, starsza już nie', () => {
    expect(
      isPaymentExpired(CREATED_AT, new Date('2026-08-02T10:14:59.999Z')),
    ).toBe(false);
    expect(
      isPaymentExpired(CREATED_AT, new Date('2026-08-02T10:15:00.001Z')),
    ).toBe(true);
  });

  it('granica jest ostra — dokładnie w deadline płatność nie jest jeszcze przeterminowana', () => {
    // Ta sama konwencja co w cancellation-policy.ts: równość należy do klienta.
    // Rekord i tak wygaśnie przy następnym ticku crona.
    expect(
      isPaymentExpired(CREATED_AT, new Date('2026-08-02T10:15:00.000Z')),
    ).toBe(false);
  });

  it('expiryCutoff jest odwrotnością deadline — te same rekordy po obu stronach granicy', () => {
    const now = new Date('2026-08-02T10:20:00.000Z');
    const cutoff = expiryCutoff(now);

    expect(cutoff).toEqual(new Date('2026-08-02T10:05:00.000Z'));
    // wszystko, co zapytanie crona (`createdAt < cutoff`) wybierze, isPaymentExpired uzna
    // za przeterminowane — i odwrotnie
    expect(CREATED_AT < cutoff).toBe(isPaymentExpired(CREATED_AT, now));

    const fresh = new Date('2026-08-02T10:10:00.000Z');
    expect(fresh < cutoff).toBe(isPaymentExpired(fresh, now));
  });
});
