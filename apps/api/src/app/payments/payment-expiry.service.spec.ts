import { Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_EXPIRY_BATCH,
  PAYMENT_EXPIRY_CRON,
  PaymentExpiryService,
} from './payment-expiry.service';
import { PAYMENT_TIMEOUT_MIN } from './payment-window';
import { PaymentsService } from './payments.service';

const NOW = new Date('2026-08-02T12:00:00.000Z');

const row = (id: string, intentId: string | null = `pi_${id}`) => ({
  id,
  bookingId: `booking-${id}`,
  stripePaymentIntentId: intentId,
});

describe('PaymentExpiryService', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let releaseUnpaid: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.spyOn>;
  let logError: ReturnType<typeof vi.spyOn>;
  let service: PaymentExpiryService;

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([row('p1')]);
    releaseUnpaid = vi.fn().mockResolvedValue(true);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new PaymentExpiryService(
      { payment: { findMany } } as unknown as PrismaService,
      { releaseUnpaid } as unknown as PaymentsService,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('bierze wyłącznie PENDING starsze niż okno płatności', async () => {
    await service.expireUnpaid(NOW);

    expect(findMany.mock.calls[0][0].where).toEqual({
      status: PaymentStatus.PENDING,
      // 12:00 − 15 min; SUCCEEDED i CANCELLED są poza zbiorem, więc opłacona rezerwacja
      // nigdy nie trafi pod anulowanie
      createdAt: { lt: new Date('2026-08-02T11:45:00.000Z') },
    });
  });

  it('pobiera tylko to, czego potrzebuje releaseUnpaid', async () => {
    await service.expireUnpaid(NOW);

    expect(findMany.mock.calls[0][0].select).toEqual({
      id: true,
      bookingId: true,
      stripePaymentIntentId: true,
    });
  });

  it('wsad jest ograniczony, najstarsze płatności idą pierwsze', async () => {
    await service.expireUnpaid(NOW);

    // bez limitu zaległość po awarii Stripe'a rozciągnęłaby tick ponad 5-minutowy interwał
    // i kolejny przebieg ruszyłby na tym samym zbiorze
    expect(findMany.mock.calls[0][0].take).toBe(PAYMENT_EXPIRY_BATCH);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });

  it('wyczerpany wsad zostawia ostrzeżenie w logu, nie udaje „wygaszono wszystko"', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findMany.mockResolvedValue(
      Array.from({ length: PAYMENT_EXPIRY_BATCH }, (_, i) => row(`p${i}`)),
    );

    await expect(service.expireUnpaid(NOW)).resolves.toBe(PAYMENT_EXPIRY_BATCH);
    expect(warn).toHaveBeenCalled();
  });

  it('niepełny wsad nie ostrzega', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.expireUnpaid(NOW);

    expect(warn).not.toHaveBeenCalled();
  });

  it('zwalnia każdy znaleziony termin i zwraca ich liczbę', async () => {
    findMany.mockResolvedValue([row('p1'), row('p2')]);

    await expect(service.expireUnpaid(NOW)).resolves.toBe(2);
    expect(releaseUnpaid).toHaveBeenCalledTimes(2);
    expect(releaseUnpaid).toHaveBeenCalledWith(row('p2'));
  });

  it('płatność, która w międzyczasie przeszła, nie liczy się jako zwolniona', async () => {
    // releaseUnpaid oddaje false, gdy Stripe potwierdzi, że intent jest już succeeded
    releaseUnpaid.mockResolvedValue(false);

    await expect(service.expireUnpaid(NOW)).resolves.toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('błąd jednego rekordu nie przerywa przebiegu', async () => {
    findMany.mockResolvedValue([row('p1'), row('p2'), row('p3')]);
    releaseUnpaid.mockRejectedValueOnce(new Error('Stripe down'));

    await expect(service.expireUnpaid(NOW)).resolves.toBe(2);
    expect(releaseUnpaid).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalled();
  });

  it('błąd bazy jest logowany, a metoda nie odrzuca', async () => {
    findMany.mockRejectedValue(new Error('DB down'));

    await expect(service.expireUnpaid(NOW)).resolves.toBe(0);
    expect(logError).toHaveBeenCalled();
    expect(releaseUnpaid).not.toHaveBeenCalled();
  });

  it('pusty przebieg milczy w logach', async () => {
    findMany.mockResolvedValue([]);

    await expect(service.expireUnpaid(NOW)).resolves.toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('domyślny `now` to chwila wywołania', async () => {
    const before = Date.now();
    await service.expireUnpaid();

    const cutoff: Date = findMany.mock.calls[0][0].where.createdAt.lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(
      before - PAYMENT_TIMEOUT_MIN * 60_000,
    );
    expect(cutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - PAYMENT_TIMEOUT_MIN * 60_000,
    );
  });

  it('handleCron uruchamia wygaszanie i nie rzuca', async () => {
    findMany.mockRejectedValue(new Error('DB down'));

    expect(() => service.handleCron()).not.toThrow();
    await vi.waitFor(() => expect(findMany).toHaveBeenCalled());
  });

  it('harmonogram to co 5 minut, nie co 5 sekund', () => {
    // sześciopolowy wariant @Cron liczy sekundy — literówka zamieniłaby 288 przebiegów
    // na dobę na 17280
    expect(PAYMENT_EXPIRY_CRON.trim().split(/\s+/)).toEqual([
      '*/5',
      '*',
      '*',
      '*',
      '*',
    ]);
  });

  it('cron chodzi częściej niż okno płatności, więc slot nie wisi po terminie', () => {
    const everyMin = Number(
      PAYMENT_EXPIRY_CRON.split(' ')[0].replace('*/', ''),
    );
    expect(everyMin).toBeLessThan(PAYMENT_TIMEOUT_MIN);
  });
});
