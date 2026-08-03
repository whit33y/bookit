import { BookingStatus, NotificationType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { InAppNotificationsService } from './in-app.service';
import { BookingEventData } from './templates/booking-event';

const BOOKING_ID = 'b1';
const USER_ID = 'u1';

const bookingData = (): BookingEventData => ({
  startsAt: new Date('2026-01-14T08:00:00.000Z'),
  endsAt: new Date('2026-01-14T09:00:00.000Z'),
  clientNote: null,
  client: { firstName: 'Jan', lastName: 'Kowalski', phone: null },
  business: {
    name: 'Salon Ola',
    slug: 'salon-ola',
    street: 'ul. Kwiatowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    phone: null,
  },
  service: { name: 'Strzyżenie damskie', durationMin: 60, priceCents: 12000 },
  employee: { name: 'Ola' },
});

describe('InAppNotificationsService', () => {
  let create: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let service: InAppNotificationsService;

  beforeEach(() => {
    create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'n1', ...data }));
    findMany = vi.fn().mockResolvedValue([]);
    findFirst = vi.fn().mockResolvedValue(null);
    count = vi.fn().mockResolvedValue(0);
    updateMany = vi.fn().mockResolvedValue({ count: 1 });
    service = new InAppNotificationsService({
      notification: { create, findMany, findFirst, count, updateMany },
    } as unknown as PrismaService);
  });

  describe('createForBooking', () => {
    it('zapisuje wyrenderowaną treść, typ, link i odbiorcę', async () => {
      await service.createForBooking(
        BookingStatus.CONFIRMED,
        BOOKING_ID,
        bookingData(),
        USER_ID,
      );

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data).toMatchObject({
        userId: USER_ID,
        bookingId: BOOKING_ID,
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Rezerwacja potwierdzona',
        url: `/client?booking=${BOOKING_ID}`,
      });
    });

    it('zdarzenie bez adresata nie dotyka bazy', async () => {
      await service.createForBooking(
        BookingStatus.COMPLETED,
        BOOKING_ID,
        bookingData(),
        USER_ID,
      );

      expect(create).not.toHaveBeenCalled();
    });

    // Powiadomienie jest efektem ubocznym zapisanej już rezerwacji — wołający robi `void`,
    // więc odrzucenie tutaj byłoby nieobsłużone (ten sam kontrakt co kanał mailowy, AC #37)
    it('błąd zapisu nie propaguje do wołającego', async () => {
      create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.createForBooking('CREATED', BOOKING_ID, bookingData(), USER_ID),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('filtruje po użytkowniku, sortuje najnowsze z tiebreakerem i stronicuje', async () => {
      count.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

      const result = await service.list(USER_ID, { page: '2', limit: '5' });

      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: { userId: USER_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      });
      expect(result).toMatchObject({ total: 7, unread: 3, page: 2, limit: 5 });
    });

    it('domyślny limit jest krótszy niż globalny — dzwoneczek pokazuje świeże, nie archiwum', async () => {
      await service.list(USER_ID, {});

      expect(findMany.mock.calls[0][0].take).toBe(10);
    });

    it('licznik nieprzeczytanych patrzy tylko na readAt: null', async () => {
      await service.list(USER_ID, {});

      expect(count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
      expect(count).toHaveBeenCalledWith({
        where: { userId: USER_ID, readAt: null },
      });
    });

    // parsePagination przed zapytaniem: zły limit ma dać 400, a nie kosztować SELECT-a
    it('limit poza zakresem → 400 bez zapytania do bazy', async () => {
      await expect(service.list(USER_ID, { limit: '999' })).rejects.toMatchObject({
        status: 400,
      });
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('liczy tylko nieprzeczytane bieżącego użytkownika', async () => {
      count.mockResolvedValue(2);

      await expect(service.unreadCount(USER_ID)).resolves.toEqual({ unread: 2 });
      expect(count).toHaveBeenCalledWith({
        where: { userId: USER_ID, readAt: null },
      });
      expect(count).toHaveBeenCalledTimes(1);
    });
  });

  describe('markRead', () => {
    it('oznacza własne nieprzeczytane i oddaje moment odczytu', async () => {
      const result = await service.markRead(USER_ID, 'n1');

      expect(updateMany.mock.calls[0][0].where).toEqual({
        id: 'n1',
        userId: USER_ID,
        readAt: null,
      });
      expect(result.id).toBe('n1');
      expect(result.readAt).toBeInstanceOf(Date);
      // trafienie nie wymaga dodatkowego odczytu
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('cudze powiadomienie → 404, bez zapisu', async () => {
      updateMany.mockResolvedValue({ count: 0 });
      findFirst.mockResolvedValue(null);

      await expect(service.markRead(USER_ID, 'obce')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('drugie oznaczenie nie przesuwa readAt — idempotencja', async () => {
      const readAt = new Date('2026-01-14T10:00:00.000Z');
      updateMany.mockResolvedValue({ count: 0 });
      findFirst.mockResolvedValue({ id: 'n1', readAt });

      await expect(service.markRead(USER_ID, 'n1')).resolves.toEqual({
        id: 'n1',
        readAt,
      });
    });
  });

  describe('markAllRead', () => {
    it('oznacza wyłącznie własne nieprzeczytane i zwraca ich liczbę', async () => {
      updateMany.mockResolvedValue({ count: 4 });

      await expect(service.markAllRead(USER_ID)).resolves.toEqual({ updated: 4 });
      expect(updateMany.mock.calls[0][0].where).toEqual({
        userId: USER_ID,
        readAt: null,
      });
    });
  });
});
