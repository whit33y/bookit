import { BookingStatus, Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { BookingEventsService } from './booking-events.service';
import { BookingsService } from './bookings.service';

// zimowa środa 2026-01-14 (weekday 2), CET → 09:00 lokalnie = 08:00Z.
// Grafik 09:00–11:00, usługa 60 min → mieszczą się starty 08:00Z … 09:00Z.
const STARTS_AT = '2026-01-14T08:00:00.000Z';
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUSINESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BOOKING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

type BusyRow = { startsAt: Date; endsAt: Date };

// hook powiadomień z M7 — serwis ma go wołać, ale nic z niego nie odczytuje
const eventsMock = () => ({ statusChanged: vi.fn() }) as unknown as BookingEventsService;

// odwzorowanie warunku nachodzenia z WHERE (startsAt: { lt }, endsAt: { gt })
const overlappingRows = (rows: BusyRow[], where: Prisma.BookingWhereInput) => {
  const before = (where.startsAt as { lt: Date }).lt;
  const after = (where.endsAt as { gt: Date }).gt;
  return rows.filter((r) => r.startsAt < before && r.endsAt > after);
};

describe('BookingsService', () => {
  let serviceFindFirst: ReturnType<typeof vi.fn>;
  let whFindMany: ReturnType<typeof vi.fn>;
  let timeOffFindMany: ReturnType<typeof vi.fn>;
  let bookingFindMany: ReturnType<typeof vi.fn>;
  let bookingCreate: ReturnType<typeof vi.fn>;
  let executeRaw: ReturnType<typeof vi.fn>;
  let calls: string[];
  let service: BookingsService;

  beforeEach(() => {
    // czas zamrożony przed rezerwowanym dniem, żeby walidacja przyszłości go nie odrzuciła
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    calls = [];
    const record = <T>(name: string, value: T) => {
      calls.push(name);
      return value;
    };

    serviceFindFirst = vi.fn().mockResolvedValue({
      businessId: BUSINESS_ID,
      durationMin: 60,
      employees: [{ id: EMPLOYEE_ID }],
    });
    executeRaw = vi.fn().mockImplementation(() => Promise.resolve(record('lock', 1)));
    whFindMany = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(record('workingHours', [{ startTime: '09:00', endTime: '11:00' }])),
      );
    timeOffFindMany = vi.fn().mockImplementation(() => Promise.resolve(record('timeOff', [])));
    bookingFindMany = vi.fn().mockImplementation(() => Promise.resolve(record('booking', [])));
    bookingCreate = vi
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: 'booking-1', ...data }));

    const tx = {
      $executeRaw: executeRaw,
      workingHours: { findMany: whFindMany },
      timeOff: { findMany: timeOffFindMany },
      booking: { findMany: bookingFindMany, create: bookingCreate },
    };

    service = new BookingsService(
      {
        service: { findFirst: serviceFindFirst },
        $transaction: (cb: (client: typeof tx) => unknown) => cb(tx),
      } as unknown as PrismaService,
      eventsMock(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const create = (overrides: Partial<Parameters<BookingsService['create']>[1]> = {}) =>
    service.create(CLIENT_ID, {
      serviceId: SERVICE_ID,
      employeeId: EMPLOYEE_ID,
      startsAt: STARTS_AT,
      ...overrides,
    });

  describe('happy path', () => {
    it('tworzy rezerwację PENDING z clientId z tokena', async () => {
      const booking = await create({ clientNote: 'Proszę o kolor ciemny' });

      expect(bookingCreate).toHaveBeenCalledTimes(1);
      expect(bookingCreate.mock.calls[0][0].data).toEqual({
        clientId: CLIENT_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        serviceId: SERVICE_ID,
        startsAt: new Date(STARTS_AT),
        endsAt: new Date('2026-01-14T09:00:00.000Z'),
        clientNote: 'Proszę o kolor ciemny',
      });
      // status nie jest ustawiany ręcznie — schodzi z domyślnego PENDING w schemacie
      expect(bookingCreate.mock.calls[0][0].data).not.toHaveProperty('status');
      expect(bookingCreate.mock.calls[0][0].select).toHaveProperty('status', true);
      expect(booking).toHaveProperty('id', 'booking-1');
    });

    it('endsAt liczone z durationMin usługi, nie z body', async () => {
      serviceFindFirst.mockResolvedValue({
        businessId: BUSINESS_ID,
        durationMin: 30,
        employees: [{ id: EMPLOYEE_ID }],
      });

      await create();

      expect(bookingCreate.mock.calls[0][0].data.endsAt).toEqual(
        new Date('2026-01-14T08:30:00.000Z'),
      );
    });

    it('bez notatki zapisuje null', async () => {
      await create();

      expect(bookingCreate.mock.calls[0][0].data.clientNote).toBeNull();
    });

    it('rezerwacja stykająca się końcem z cudzą przechodzi', async () => {
      bookingFindMany.mockImplementation(({ where }: { where: Prisma.BookingWhereInput }) =>
        Promise.resolve(
          overlappingRows(
            [
              {
                startsAt: new Date('2026-01-14T09:00:00.000Z'), // 10:00 lokalnie
                endsAt: new Date('2026-01-14T10:00:00.000Z'),
              },
            ],
            where,
          ),
        ),
      );

      await expect(create()).resolves.toHaveProperty('id', 'booking-1');
    });
  });

  describe('walidacja czasu', () => {
    it('startsAt poza siatką 15 min → 400, bez zapytań do bazy', async () => {
      await expect(create({ startsAt: '2026-01-14T08:07:00.000Z' })).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('niezerowe sekundy też są poza siatką → 400', async () => {
      await expect(create({ startsAt: '2026-01-14T08:00:30.000Z' })).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('startsAt w przeszłości → 400, bez zapytań do bazy', async () => {
      await expect(create({ startsAt: '2025-12-31T10:00:00.000Z' })).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('startsAt równe teraz → 400 (musi być w przyszłości)', async () => {
      await expect(create({ startsAt: '2026-01-01T00:00:00.000Z' })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('scope usługi, pracownika i firmy', () => {
    it('pyta o usługę aktywną w firmie niezablokowanej, z aktywnym przypisanym pracownikiem', async () => {
      await create();

      expect(serviceFindFirst).toHaveBeenCalledWith({
        where: { id: SERVICE_ID, isActive: true, business: { isBlocked: false } },
        select: {
          businessId: true,
          durationMin: true,
          employees: { where: { id: EMPLOYEE_ID, isActive: true }, select: { id: true } },
        },
      });
    });

    it('usługa nieaktywna, nieistniejąca lub firma zablokowana → 404', async () => {
      serviceFindFirst.mockResolvedValue(null);

      await expect(create()).rejects.toMatchObject({ status: 404 });
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it('pracownik nieprzypisany do usługi lub nieaktywny → 404', async () => {
      serviceFindFirst.mockResolvedValue({
        businessId: BUSINESS_ID,
        durationMin: 60,
        employees: [],
      });

      await expect(create()).rejects.toMatchObject({ status: 404 });
      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('re-walidacja slotu w transakcji', () => {
    it('advisory lock zakłada się przed odczytem grafiku i kolizji', async () => {
      await create();

      expect(calls[0]).toBe('lock');
      expect(calls).toContain('booking');
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it('pyta o grafik dnia tygodnia z daty lokalnej startsAt', async () => {
      await create();

      // 2026-01-14 to środa → weekday 2 w konwencji Prismy (0 = poniedziałek)
      expect(whFindMany).toHaveBeenCalledWith({
        where: { employeeId: EMPLOYEE_ID, weekday: 2 },
        select: { startTime: true, endTime: true },
      });
    });

    it('slot wychodzący za grafik → 409', async () => {
      // 10:15 lokalnie + 60 min = 11:15, a grafik kończy się 11:00
      await expect(create({ startsAt: '2026-01-14T09:15:00.000Z' })).rejects.toMatchObject({
        status: 409,
      });
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it('brak grafiku na ten dzień → 409', async () => {
      whFindMany.mockResolvedValue([]);

      await expect(create()).rejects.toMatchObject({ status: 409 });
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it('nachodzący urlop → 409', async () => {
      timeOffFindMany.mockResolvedValue([
        {
          startsAt: new Date('2026-01-14T08:30:00.000Z'),
          endsAt: new Date('2026-01-14T12:00:00.000Z'),
        },
      ]);

      await expect(create()).rejects.toMatchObject({ status: 409 });
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it('pyta tylko o rezerwacje PENDING i CONFIRMED nachodzące na slot', async () => {
      await create();

      expect(bookingFindMany).toHaveBeenCalledWith({
        where: {
          employeeId: EMPLOYEE_ID,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          startsAt: { lt: new Date('2026-01-14T09:00:00.000Z') },
          endsAt: { gt: new Date(STARTS_AT) },
        },
        select: { startsAt: true, endsAt: true },
      });
    });

    it('nachodząca rezerwacja PENDING → 409', async () => {
      bookingFindMany.mockResolvedValue([
        {
          startsAt: new Date('2026-01-14T08:30:00.000Z'),
          endsAt: new Date('2026-01-14T09:30:00.000Z'),
        },
      ]);

      await expect(create()).rejects.toMatchObject({ status: 409 });
      expect(bookingCreate).not.toHaveBeenCalled();
    });
  });

  describe('współbieżność', () => {
    // Advisory lock odwzorowany łańcuchem promise'ów: druga transakcja wchodzi dopiero,
    // gdy pierwsza się skończy — dokładnie ta gwarancja, którą daje pg_advisory_xact_lock.
    // Rezerwacje żyją we wspólnej tablicy, więc druga transakcja widzi zapis pierwszej.
    const buildSerializedService = () => {
      const stored: BusyRow[] = [];
      let queue: Promise<unknown> = Promise.resolve();

      const tx = {
        $executeRaw: () => Promise.resolve(1),
        workingHours: {
          findMany: () => Promise.resolve([{ startTime: '09:00', endTime: '11:00' }]),
        },
        timeOff: { findMany: () => Promise.resolve([]) },
        booking: {
          findMany: ({ where }: { where: Prisma.BookingWhereInput }) =>
            Promise.resolve(overlappingRows(stored, where)),
          create: ({ data }: { data: BusyRow }) => {
            stored.push({ startsAt: data.startsAt, endsAt: data.endsAt });
            return Promise.resolve({ id: `booking-${stored.length}`, ...data });
          },
        },
      };

      const prisma = {
        service: {
          findFirst: () =>
            Promise.resolve({
              businessId: BUSINESS_ID,
              durationMin: 60,
              employees: [{ id: EMPLOYEE_ID }],
            }),
        },
        $transaction: (cb: (client: typeof tx) => unknown) => {
          const result = queue.then(() => cb(tx));
          queue = result.catch(() => undefined);
          return result;
        },
      };

      return {
        service: new BookingsService(prisma as unknown as PrismaService, eventsMock()),
        stored,
      };
    };

    it('dwie równoległe rezerwacje tego samego slotu → dokładnie jedna przechodzi', async () => {
      const { service: serialized, stored } = buildSerializedService();
      const dto = {
        serviceId: SERVICE_ID,
        employeeId: EMPLOYEE_ID,
        startsAt: STARTS_AT,
      };

      const results = await Promise.allSettled([
        serialized.create(CLIENT_ID, dto),
        serialized.create('dddddddd-dddd-4ddd-8ddd-dddddddddddd', dto),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ status: 409 });
      // w bazie ląduje jedna rezerwacja, nie dwie
      expect(stored).toHaveLength(1);
    });

    it('dwie równoległe rezerwacje rozłącznych slotów → obie przechodzą', async () => {
      const { service: serialized, stored } = buildSerializedService();
      const base = { serviceId: SERVICE_ID, employeeId: EMPLOYEE_ID };

      const results = await Promise.allSettled([
        serialized.create(CLIENT_ID, { ...base, startsAt: STARTS_AT }),
        // 10:00 lokalnie — styk z poprzednią, nie kolizja
        serialized.create(CLIENT_ID, { ...base, startsAt: '2026-01-14T09:00:00.000Z' }),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(stored).toHaveLength(2);
    });
  });
});

describe('BookingsService — decyzje firmy', () => {
  let bookingFindUnique: ReturnType<typeof vi.fn>;
  let bookingUpdate: ReturnType<typeof vi.fn>;
  let statusChanged: ReturnType<typeof vi.fn>;
  let service: BookingsService;

  // rezerwacja właściciela OWNER_ID w podanym statusie
  const existing = (status: BookingStatus) => ({
    status,
    business: { ownerId: OWNER_ID },
  });

  beforeEach(() => {
    bookingFindUnique = vi.fn().mockResolvedValue(existing(BookingStatus.PENDING));
    bookingUpdate = vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: BOOKING_ID, businessId: BUSINESS_ID, ...data }),
      );
    statusChanged = vi.fn();

    service = new BookingsService(
      {
        booking: { findUnique: bookingFindUnique, update: bookingUpdate },
      } as unknown as PrismaService,
      { statusChanged } as unknown as BookingEventsService,
    );
  });

  describe('happy path', () => {
    it('confirm: PENDING → CONFIRMED', async () => {
      const booking = await service.confirm(OWNER_ID, BOOKING_ID);

      expect(bookingUpdate).toHaveBeenCalledTimes(1);
      expect(bookingUpdate.mock.calls[0][0].data).toEqual({
        status: BookingStatus.CONFIRMED,
      });
      expect(booking).toHaveProperty('status', BookingStatus.CONFIRMED);
    });

    it('decline: PENDING → DECLINED', async () => {
      const booking = await service.decline(OWNER_ID, BOOKING_ID);

      expect(bookingUpdate.mock.calls[0][0].data).toEqual({
        status: BookingStatus.DECLINED,
      });
      expect(booking).toHaveProperty('status', BookingStatus.DECLINED);
    });

    it('zapis zawężony statusem odczytanym wcześniej (ochrona przed wyścigiem)', async () => {
      await service.confirm(OWNER_ID, BOOKING_ID);

      expect(bookingUpdate.mock.calls[0][0].where).toEqual({
        id: BOOKING_ID,
        status: BookingStatus.PENDING,
      });
    });

    it('odpowiedź nie zawiera pól spoza bookingSelect', async () => {
      await service.confirm(OWNER_ID, BOOKING_ID);

      // clientNote jest w select, ownerId firmy — nie
      expect(bookingUpdate.mock.calls[0][0].select).toHaveProperty('clientNote', true);
      expect(bookingUpdate.mock.calls[0][0].select).not.toHaveProperty('business');
    });
  });

  describe('uprawnienia', () => {
    it('nieistniejąca rezerwacja → 404, bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue(null);

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 404,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('właściciel innej firmy → 403, bez zapisu', async () => {
      await expect(service.confirm(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('decline cudzej rezerwacji też → 403', async () => {
      await expect(service.decline(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });
  });

  describe('maszyna stanów', () => {
    const NON_PENDING = [
      BookingStatus.CONFIRMED,
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CLIENT,
      BookingStatus.CANCELLED_BY_BUSINESS,
      BookingStatus.COMPLETED,
    ];

    it.each(NON_PENDING)('confirm rezerwacji w statusie %s → 409, bez zapisu', async (status) => {
      bookingFindUnique.mockResolvedValue(existing(status));

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 409,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it.each(NON_PENDING)('decline rezerwacji w statusie %s → 409, bez zapisu', async (status) => {
      bookingFindUnique.mockResolvedValue(existing(status));

      await expect(service.decline(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 409,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('komunikat 409 mówi po polsku, w jakim stanie jest rezerwacja', async () => {
      bookingFindUnique.mockResolvedValue(existing(BookingStatus.CONFIRMED));

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        message: expect.stringContaining('potwierdzona'),
      });
    });

    it('wyścig: status zmieniony między odczytem a zapisem → 409, nie 500', async () => {
      bookingUpdate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 409,
      });
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('inny błąd bazy leci dalej (nie jest przebierany na 409)', async () => {
      bookingUpdate.mockRejectedValue(new Error('połączenie zerwane'));

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toThrow(
        'połączenie zerwane',
      );
    });
  });

  describe('punkt zaczepienia dla maili z M7', () => {
    it('statusChanged wołany raz po udanym przejściu, z from i to', async () => {
      const booking = await service.confirm(OWNER_ID, BOOKING_ID);

      expect(statusChanged).toHaveBeenCalledTimes(1);
      expect(statusChanged).toHaveBeenCalledWith(
        booking,
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
      );
    });

    it('decline zgłasza przejście do DECLINED', async () => {
      await service.decline(OWNER_ID, BOOKING_ID);

      expect(statusChanged).toHaveBeenCalledWith(
        expect.anything(),
        BookingStatus.PENDING,
        BookingStatus.DECLINED,
      );
    });

    // AC #37: „błąd wysyłki nie wywala operacji na rezerwacji (log + kontynuacja)".
    // Zdarzenie leci po zatwierdzonym zapisie, więc jego padnięcie nie może zamienić
    // udanego potwierdzenia w 500 — status w bazie i tak jest już zmieniony.
    it('wyjątek z hooka nie wywala operacji — rezerwacja wraca potwierdzona', async () => {
      statusChanged.mockImplementation(() => {
        throw new Error('SMTP niedostępny');
      });

      const booking = await service.confirm(OWNER_ID, BOOKING_ID);

      expect(booking).toHaveProperty('status', BookingStatus.CONFIRMED);
      expect(bookingUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
