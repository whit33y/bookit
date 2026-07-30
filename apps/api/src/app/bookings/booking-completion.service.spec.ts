import { Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { BookingCompletionService, COMPLETION_CRON } from './booking-completion.service';
import { canTransition } from './booking-status';

// completePastBookings bierze `now` argumentem, więc granicę okna testujemy bez fake timerów.
const NOW = new Date('2026-01-13T12:00:00.000Z');

describe('BookingCompletionService', () => {
  let updateMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.spyOn>;
  let logError: ReturnType<typeof vi.spyOn>;
  let service: BookingCompletionService;

  beforeEach(() => {
    updateMany = vi.fn().mockResolvedValue({ count: 1 });
    update = vi.fn();
    findMany = vi.fn();
    // Logger podmieniony na wszystkie testy, nie tylko te, które go sprawdzają — inaczej
    // przebieg suite zasypałby wyjście logami z crona.
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new BookingCompletionService({
      booking: { updateMany, update, findMany },
    } as unknown as PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC: „przechodzą wyłącznie CONFIRMED z endsAt w przeszłości; inne statusy nietknięte".
  // Cały warunek siedzi w jednym WHERE, więc porównujemy go w całości — toEqual wychwyci
  // też warunek dołożony obok, nie tylko zmieniony.
  it('przestawia wyłącznie CONFIRMED zakończone przed `now`', async () => {
    await service.completePastBookings(NOW);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { status: BookingStatus.CONFIRMED, endsAt: { lt: NOW } },
      data: { status: BookingStatus.COMPLETED },
    });
  });

  // AC: „operacja masowa (jeden update, nie pętla per rekord)". updateMany dokładnie raz
  // i żadnego zapytania per rezerwacja — ani odczytu paczki, ani update'ów pojedynczych.
  it('robi jedno zapytanie zbiorcze, bez pętli po rezerwacjach', async () => {
    updateMany.mockResolvedValue({ count: 25 });

    await expect(service.completePastBookings(NOW)).resolves.toBe(25);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // AC: „operacja idempotentna". Drugi przebieg na tym samym stanie nie ma już czego zmienić,
  // bo rekordy przestały pasować do WHERE — count 0 to normalny wynik, nie błąd.
  it('powtórny przebieg nic nie zmienia i nie hałasuje w logach', async () => {
    updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });

    await expect(service.completePastBookings(NOW)).resolves.toBe(2);
    await expect(service.completePastBookings(NOW)).resolves.toBe(0);

    // pusty tick milczy — przy 96 przebiegach na dobę log per tick byłby samym szumem
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('domyślny `now` to chwila wywołania', async () => {
    const before = new Date();
    await service.completePastBookings();
    const after = new Date();

    const { lt } = updateMany.mock.calls[0][0].where.endsAt;
    expect(lt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(lt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  // Warunek bezpieczeństwa dla `void` w handleCron: gdyby metoda odrzucała, @Cron nie miałby
  // komu oddać promisy i błąd wyleciałby jako unhandledRejection.
  it('błąd bazy jest logowany, a metoda nie odrzuca', async () => {
    updateMany.mockRejectedValue(new Error('connection terminated'));

    await expect(service.completePastBookings(NOW)).resolves.toBe(0);

    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('handleCron uruchamia domykanie i nie rzuca', () => {
    expect(() => service.handleCron()).not.toThrow();

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  // AC: „job co 15 min". Sam przebieg jest testowany bezpośrednio przez completePastBookings,
  // więc harmonogram nie ma innego strażnika — a wariant sześciopolowy ('*/15 * * * * *')
  // znaczy „co 15 sekund" i przeszedłby testy, lint i build niezauważony.
  it('harmonogram to co 15 minut, nie co 15 sekund', () => {
    expect(COMPLETION_CRON.trim().split(/\s+/)).toEqual(['*/15', '*', '*', '*', '*']);
  });

  // Job omija BookingsService.transition(), więc nie przechodzi przez canTransition w czasie
  // pracy. Gdyby krawędź zniknęła z diagramu (SDD §7), cron po cichu łamałby maszynę stanów —
  // tutaj to zwykły czerwony test, a nie wywrócony start aplikacji.
  it('opiera się na krawędzi CONFIRMED → COMPLETED z maszyny stanów', () => {
    expect(canTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED)).toBe(true);
  });
});
