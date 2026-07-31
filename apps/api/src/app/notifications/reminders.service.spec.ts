import { BookingStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

// AC #38: „test logiki wyznaczania okna (bez realnego czekania — czas wstrzykiwany)".
// sendDueReminders bierze `now` argumentem, więc żadnych fake timerów.
const NOW = new Date('2026-01-13T12:00:00.000Z');
// okno nadganiające: od progu 2 h do 24 h 15 min przed wizytą (patrz reminder-window.ts)
const WINDOW_FROM = new Date('2026-01-13T14:00:00.000Z');
const WINDOW_TO = new Date('2026-01-14T12:15:00.000Z');

const BOOKING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const OTHER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('RemindersService', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let bookingReminder: ReturnType<typeof vi.fn>;
  let service: RemindersService;

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([{ id: BOOKING_ID }]);
    updateMany = vi.fn().mockResolvedValue({ count: 1 });
    bookingReminder = vi.fn().mockResolvedValue(true);
    service = new RemindersService(
      { booking: { findMany, updateMany } } as unknown as PrismaService,
      { bookingReminder } as unknown as NotificationsService,
    );
  });

  it('szuka wyłącznie CONFIRMED bez przypomnienia, ze startem w oknie', async () => {
    await service.sendDueReminders(NOW);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: BookingStatus.CONFIRMED,
      reminderSentAt: null,
      startsAt: { gte: WINDOW_FROM, lt: WINDOW_TO },
    });
  });

  it('wysyła przypomnienie i zaznacza reminderSentAt na moment przebiegu', async () => {
    await expect(service.sendDueReminders(NOW)).resolves.toBe(1);

    expect(bookingReminder).toHaveBeenCalledWith(BOOKING_ID);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({
      // guard na `reminderSentAt: null` — to on daje „dokładnie raz"; `status` chroni przed
      // wysyłką do rezerwacji odwołanej już po SELECT-cie
      where: { id: BOOKING_ID, status: BookingStatus.CONFIRMED, reminderSentAt: null },
      data: { reminderSentAt: NOW },
    });
  });

  // Między SELECT-em a zajęciem rekordu mija wysyłka poprzednich maili z paczki — klient może
  // w tym czasie odwołać wizytę, a wtedy UPDATE nie łapie rekordu i mail nie wychodzi (AC #38).
  it('rezerwacja odwołana po odczycie, przed zajęciem rekordu, nie dostaje maila', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
    expect(updateMany.mock.calls[0][0].where.status).toBe(BookingStatus.CONFIRMED);
    expect(bookingReminder).not.toHaveBeenCalled();
  });

  // Znacznik ustawiany PRZED wysyłką, więc kolejność przesądza o duplikatach
  it('zaznacza reminderSentAt przed wysyłką, nie po', async () => {
    const order: string[] = [];
    updateMany.mockImplementation(async () => {
      order.push('claim');
      return { count: 1 };
    });
    bookingReminder.mockImplementation(async () => {
      order.push('send');
      return true;
    });

    await service.sendDueReminders(NOW);

    expect(order).toEqual(['claim', 'send']);
  });

  // Wyścig: druga instancja API (albo nakładający się tick) zdążyła zająć rekord
  it('przegrany wyścig o rekord nie wysyła maila', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
    expect(bookingReminder).not.toHaveBeenCalled();
  });

  it('nieudana wysyłka cofa reminderSentAt', async () => {
    bookingReminder.mockResolvedValue(false);

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toEqual({
      // cofnięcie zawężone do znacznika z tego przebiegu, żeby nie wyczyścić cudzego
      where: { id: BOOKING_ID, reminderSentAt: NOW },
      data: { reminderSentAt: null },
    });
  });

  it('obsługuje wiele rezerwacji w jednym przebiegu', async () => {
    findMany.mockResolvedValue([{ id: BOOKING_ID }, { id: OTHER_ID }]);

    await expect(service.sendDueReminders(NOW)).resolves.toBe(2);
    expect(bookingReminder.mock.calls.map(([id]) => id)).toEqual([BOOKING_ID, OTHER_ID]);
  });

  it('pusty przebieg nie rusza bazy ani SMTP', async () => {
    findMany.mockResolvedValue([]);

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(bookingReminder).not.toHaveBeenCalled();
  });

  // @Cron nie ma komu oddać odrzuconej promisy — wyjątek byłby unhandledRejection
  it('błąd bazy nie propaguje z przebiegu', async () => {
    findMany.mockRejectedValue(new Error('DB down'));

    await expect(service.sendDueReminders(NOW)).resolves.toBe(0);
  });

  // Okno mija i nikt do niego nie wróci, więc awaria na jednej rezerwacji nie może zabrać
  // przypomnień pozostałym z tej samej paczki.
  it('błąd na jednej rezerwacji nie przerywa reszty paczki', async () => {
    findMany.mockResolvedValue([{ id: BOOKING_ID }, { id: OTHER_ID }]);
    updateMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === BOOKING_ID) {
        throw new Error('deadlock detected');
      }
      return { count: 1 };
    });

    await expect(service.sendDueReminders(NOW)).resolves.toBe(1);
    expect(bookingReminder).toHaveBeenCalledTimes(1);
    expect(bookingReminder).toHaveBeenCalledWith(OTHER_ID);
  });

  it('handleCron odpala przebieg i nie rzuca', async () => {
    expect(() => service.handleCron()).not.toThrow();

    // przebieg idzie w tle (`void`) — czekamy na mikrotaski, żeby zobaczyć jego efekt
    await vi.waitFor(() => expect(findMany).toHaveBeenCalled());
  });
});
