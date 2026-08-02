import { Logger } from '@nestjs/common';
import {
  BookingStatus,
  DepositType,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMinutes,
  localDayRangeUtc,
  parseLocalDate,
} from '../availability/business-time';
import { AuthUser } from '../common/types/auth-user';
import { PaymentsService } from '../payments/payments.service';
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
const EMPLOYEE_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_EMPLOYEE_ID = '99999999-9999-4999-8999-999999999999';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const PAYMENT_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

type BusyRow = { startsAt: Date; endsAt: Date };

// hook powiadomień (#37) — serwis ma go wołać, ale nic z niego nie odczytuje
const eventsMock = () =>
  ({
    statusChanged: vi.fn(),
    created: vi.fn(),
  }) as unknown as BookingEventsService;

// PaymentsService widziany od strony bookings (#51): rozgałęzienie po isEnabled, PaymentIntent
// przy rezerwacji z zaliczką i unieważnienie nieopłaconej zaliczki przy odwołaniu.
const paymentsMock = (overrides: Record<string, unknown> = {}) =>
  ({
    isEnabled: true,
    createDepositIntent: vi.fn().mockResolvedValue({
      paymentIntentId: 'pi_1',
      clientSecret: 'pi_1_secret',
    }),
    releaseUnpaid: vi.fn().mockResolvedValue(true),
    ...overrides,
  }) as unknown as PaymentsService;

// usługa bez zaliczki — domyślny kształt zwracany przez service.findFirst w create()
const serviceRow = (deposit: Partial<Record<string, unknown>> = {}) => ({
  businessId: BUSINESS_ID,
  durationMin: 60,
  priceCents: 22000,
  depositType: null,
  depositValue: null,
  employees: [{ id: EMPLOYEE_ID }],
  ...deposit,
});

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
  let bookingCreated: ReturnType<typeof vi.fn>;
  let paymentUpdate: ReturnType<typeof vi.fn>;
  let payments: PaymentsService;
  let buildService: () => BookingsService;
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

    serviceFindFirst = vi.fn().mockResolvedValue(serviceRow());
    executeRaw = vi
      .fn()
      .mockImplementation(() => Promise.resolve(record('lock', 1)));
    whFindMany = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          record('workingHours', [{ startTime: '09:00', endTime: '11:00' }]),
        ),
      );
    timeOffFindMany = vi
      .fn()
      .mockImplementation(() => Promise.resolve(record('timeOff', [])));
    bookingFindMany = vi
      .fn()
      .mockImplementation(() => Promise.resolve(record('booking', [])));
    // Prisma rozwija zagnieżdżone `payment: { create }` w relację, więc atrapa musi oddać
    // utworzony wiersz, a nie surowy input — create() czyta z niego id i createdAt.
    bookingCreate = vi.fn().mockImplementation(({ data }) => {
      const { payment, ...rest } = data;
      return Promise.resolve({
        id: 'booking-1',
        ...rest,
        payment: payment
          ? { id: PAYMENT_ID, createdAt: PAYMENT_CREATED_AT }
          : null,
      });
    });
    bookingCreated = vi.fn();
    paymentUpdate = vi.fn().mockResolvedValue({});
    payments = paymentsMock();

    const tx = {
      $executeRaw: executeRaw,
      workingHours: { findMany: whFindMany },
      timeOff: { findMany: timeOffFindMany },
      booking: { findMany: bookingFindMany, create: bookingCreate },
    };

    buildService = () =>
      new BookingsService(
        {
          service: { findFirst: serviceFindFirst },
          payment: { update: paymentUpdate },
          $transaction: (cb: (client: typeof tx) => unknown) => cb(tx),
        } as unknown as PrismaService,
        {
          statusChanged: vi.fn(),
          created: bookingCreated,
        } as unknown as BookingEventsService,
        payments,
      );
    service = buildService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const create = (
    overrides: Partial<Parameters<BookingsService['create']>[1]> = {},
  ) =>
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
      expect(bookingCreate.mock.calls[0][0].select).toHaveProperty(
        'status',
        true,
      );
      expect(booking).toHaveProperty('id', 'booking-1');
    });

    it('endsAt liczone z durationMin usługi, nie z body', async () => {
      serviceFindFirst.mockResolvedValue(serviceRow({ durationMin: 30 }));

      await create();

      expect(bookingCreate.mock.calls[0][0].data.endsAt).toEqual(
        new Date('2026-01-14T08:30:00.000Z'),
      );
    });

    it('bez notatki zapisuje null', async () => {
      await create();

      expect(bookingCreate.mock.calls[0][0].data.clientNote).toBeNull();
    });

    it('zgłasza zdarzenie created z zapisaną rezerwacją (mail do firmy — #37)', async () => {
      const booking = await create();

      expect(bookingCreated).toHaveBeenCalledTimes(1);
      // bez pola payment: zdarzenie dostaje samą rezerwację, a płatność (tu null) jest
      // dokładana dopiero do odpowiedzi HTTP
      const { payment, ...withoutPayment } = booking;
      expect(payment).toBeNull();
      expect(bookingCreated).toHaveBeenCalledWith(withoutPayment);
    });

    it('rezerwacja stykająca się końcem z cudzą przechodzi', async () => {
      bookingFindMany.mockImplementation(
        ({ where }: { where: Prisma.BookingWhereInput }) =>
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
      await expect(
        create({ startsAt: '2026-01-14T08:07:00.000Z' }),
      ).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('niezerowe sekundy też są poza siatką → 400', async () => {
      await expect(
        create({ startsAt: '2026-01-14T08:00:30.000Z' }),
      ).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('startsAt w przeszłości → 400, bez zapytań do bazy', async () => {
      await expect(
        create({ startsAt: '2025-12-31T10:00:00.000Z' }),
      ).rejects.toMatchObject({
        status: 400,
      });
      expect(serviceFindFirst).not.toHaveBeenCalled();
    });

    it('startsAt równe teraz → 400 (musi być w przyszłości)', async () => {
      await expect(
        create({ startsAt: '2026-01-01T00:00:00.000Z' }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('scope usługi, pracownika i firmy', () => {
    it('pyta o usługę aktywną w firmie niezablokowanej, z aktywnym przypisanym pracownikiem', async () => {
      await create();

      expect(serviceFindFirst).toHaveBeenCalledWith({
        where: {
          id: SERVICE_ID,
          isActive: true,
          business: { isBlocked: false },
        },
        select: {
          businessId: true,
          durationMin: true,
          // pola zaliczki (#51) — z nich liczy się kwota PaymentIntenta
          priceCents: true,
          depositType: true,
          depositValue: true,
          employees: {
            where: { id: EMPLOYEE_ID, isActive: true },
            select: { id: true },
          },
        },
      });
    });

    it('usługa nieaktywna, nieistniejąca lub firma zablokowana → 404', async () => {
      serviceFindFirst.mockResolvedValue(null);

      await expect(create()).rejects.toMatchObject({ status: 404 });
      expect(bookingCreate).not.toHaveBeenCalled();
    });

    it('pracownik nieprzypisany do usługi lub nieaktywny → 404', async () => {
      serviceFindFirst.mockResolvedValue(serviceRow({ employees: [] }));

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
      await expect(
        create({ startsAt: '2026-01-14T09:15:00.000Z' }),
      ).rejects.toMatchObject({
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
          findMany: () =>
            Promise.resolve([{ startTime: '09:00', endTime: '11:00' }]),
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
        service: { findFirst: () => Promise.resolve(serviceRow()) },
        $transaction: (cb: (client: typeof tx) => unknown) => {
          const result = queue.then(() => cb(tx));
          queue = result.catch(() => undefined);
          return result;
        },
      };

      return {
        service: new BookingsService(
          prisma as unknown as PrismaService,
          eventsMock(),
          paymentsMock(),
        ),
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
        serialized.create(CLIENT_ID, {
          ...base,
          startsAt: '2026-01-14T09:00:00.000Z',
        }),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(stored).toHaveLength(2);
    });
  });

  // AC #51: „Usługa z zaliczką: POST /bookings zwraca client_secret; slot tymczasowo
  // zablokowany" oraz „Usługi bez zaliczki działają po staremu".
  describe('zaliczka (#51)', () => {
    // Koloryzacja z danych demo: 220 zł, zaliczka 30% → 66 zł
    const withDeposit = () =>
      serviceFindFirst.mockResolvedValue(
        serviceRow({ depositType: DepositType.PERCENT, depositValue: 30 }),
      );

    it('bez zaliczki: żadnego wiersza Payment, żadnego kontaktu ze Stripe, payment null', async () => {
      const booking = await create();

      expect(bookingCreate.mock.calls[0][0].data).not.toHaveProperty('payment');
      expect(payments.createDepositIntent).not.toHaveBeenCalled();
      expect(paymentUpdate).not.toHaveBeenCalled();
      expect(booking.payment).toBeNull();
      // mail do firmy wychodzi od razu, tak jak przed #51
      expect(bookingCreated).toHaveBeenCalledTimes(1);
    });

    it('z zaliczką: Payment powstaje w tej samej transakcji co rezerwacja', async () => {
      withDeposit();

      await create();

      expect(bookingCreate.mock.calls[0][0].data.payment).toEqual({
        create: { amountCents: 6600, currency: 'pln' },
      });
    });

    it('z zaliczką: odpowiedź niesie client_secret, kwotę i termin ważności', async () => {
      withDeposit();

      const booking = await create();

      expect(booking.payment).toEqual({
        amountCents: 6600,
        currency: 'pln',
        clientSecret: 'pi_1_secret',
        // createdAt płatności + 15 min
        expiresAt: new Date('2026-01-01T00:15:00.000Z'),
      });
    });

    it('z zaliczką: rezerwacja zostaje PENDING, więc slot jest zablokowany od razu', async () => {
      withDeposit();

      await create();

      // status nie jest ustawiany ręcznie — domyślny PENDING ze schematu jest
      // w BLOCKING_STATUSES, więc /availability przestaje pokazywać ten termin
      expect(bookingCreate.mock.calls[0][0].data).not.toHaveProperty('status');
    });

    it('identyfikator PaymentIntenta dopinany do płatności po odpowiedzi ze Stripe', async () => {
      withDeposit();

      await create();

      expect(paymentUpdate).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID },
        data: { stripePaymentIntentId: 'pi_1' },
      });
    });

    it('PaymentIntent tworzony po commicie transakcji, nie w środku', async () => {
      withDeposit();
      const intent = vi.fn().mockImplementation(() => {
        calls.push('stripe');
        return Promise.resolve({
          paymentIntentId: 'pi_1',
          clientSecret: 'pi_1_secret',
        });
      });
      payments = paymentsMock({ createDepositIntent: intent });
      service = buildService();

      await create();

      // Advisory lock trzyma transakcja; round-trip do Stripe'a w jej środku blokowałby
      // rezerwacje u tego pracownika na czas odpowiedzi z sieci.
      expect(calls).toEqual([
        'lock',
        'workingHours',
        'timeOff',
        'booking',
        'stripe',
      ]);
    });

    it('mail do firmy nie wychodzi przed opłaceniem zaliczki', async () => {
      withDeposit();

      await create();

      // wyśle go webhook po payment_intent.succeeded — inaczej porzucony checkout
      // zgłaszałby firmie wizytę, która za kwadrans wygaśnie
      expect(bookingCreated).not.toHaveBeenCalled();
    });

    it('brak konfiguracji Stripe → 503 i żadnego zapisu', async () => {
      withDeposit();
      payments = paymentsMock({ isEnabled: false });
      service = buildService();

      await expect(create()).rejects.toMatchObject({ status: 503 });
      expect(bookingCreate).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('brak konfiguracji Stripe nie przeszkadza usłudze bez zaliczki', async () => {
      payments = paymentsMock({ isEnabled: false });
      service = buildService();

      await expect(create()).resolves.toHaveProperty('id', 'booking-1');
    });

    it('błąd Stripe → slot zwolniony i 503, rezerwacja nie zostaje wisieć', async () => {
      withDeposit();
      const releaseUnpaid = vi.fn().mockResolvedValue(true);
      payments = paymentsMock({
        createDepositIntent: vi
          .fn()
          .mockRejectedValue(new Error('Stripe down')),
        releaseUnpaid,
      });
      service = buildService();

      await expect(create()).rejects.toMatchObject({ status: 503 });
      expect(releaseUnpaid).toHaveBeenCalledWith({
        id: PAYMENT_ID,
        bookingId: 'booking-1',
        stripePaymentIntentId: null,
      });
    });

    it('błąd zapisu po utworzeniu intentu → anulowanie idzie z jego identyfikatorem', async () => {
      withDeposit();
      const releaseUnpaid = vi.fn().mockResolvedValue(true);
      payments = paymentsMock({ releaseUnpaid });
      paymentUpdate.mockRejectedValue(new Error('DB down'));
      service = buildService();

      await expect(create()).rejects.toMatchObject({ status: 503 });
      // intent istnieje po stronie Stripe'a mimo nieudanego zapisu — bez tego id
      // zostałby wiszący PaymentIntent, którego nikt by nie anulował
      expect(releaseUnpaid).toHaveBeenCalledWith(
        expect.objectContaining({ stripePaymentIntentId: 'pi_1' }),
      );
    });
  });
});

describe('BookingsService — decyzje firmy', () => {
  let bookingFindUnique: ReturnType<typeof vi.fn>;
  let bookingUpdate: ReturnType<typeof vi.fn>;
  let statusChanged: ReturnType<typeof vi.fn>;
  let releaseUnpaid: ReturnType<typeof vi.fn>;
  let service: BookingsService;

  // rezerwacja właściciela OWNER_ID w podanym statusie
  const existing = (status: BookingStatus) => ({
    status,
    business: { ownerId: OWNER_ID },
    payment: null,
  });

  beforeEach(() => {
    bookingFindUnique = vi
      .fn()
      .mockResolvedValue(existing(BookingStatus.PENDING));
    releaseUnpaid = vi.fn().mockResolvedValue(true);
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
      { statusChanged, created: vi.fn() } as unknown as BookingEventsService,
      paymentsMock({ releaseUnpaid }),
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
      expect(bookingUpdate.mock.calls[0][0].select).toHaveProperty(
        'clientNote',
        true,
      );
      expect(bookingUpdate.mock.calls[0][0].select).not.toHaveProperty(
        'business',
      );
    });
  });

  describe('uprawnienia', () => {
    it('nieistniejąca rezerwacja → 404, bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue(null);

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 404,
        },
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('właściciel innej firmy → 403, bez zapisu', async () => {
      await expect(
        service.confirm(CLIENT_ID, BOOKING_ID),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('decline cudzej rezerwacji też → 403', async () => {
      await expect(
        service.decline(CLIENT_ID, BOOKING_ID),
      ).rejects.toMatchObject({
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

    it.each(NON_PENDING)(
      'confirm rezerwacji w statusie %s → 409, bez zapisu',
      async (status) => {
        bookingFindUnique.mockResolvedValue(existing(status));

        await expect(
          service.confirm(OWNER_ID, BOOKING_ID),
        ).rejects.toMatchObject({
          status: 409,
        });
        expect(bookingUpdate).not.toHaveBeenCalled();
        expect(statusChanged).not.toHaveBeenCalled();
      },
    );

    it.each(NON_PENDING)(
      'decline rezerwacji w statusie %s → 409, bez zapisu',
      async (status) => {
        bookingFindUnique.mockResolvedValue(existing(status));

        await expect(
          service.decline(OWNER_ID, BOOKING_ID),
        ).rejects.toMatchObject({
          status: 409,
        });
        expect(bookingUpdate).not.toHaveBeenCalled();
      },
    );

    it('komunikat 409 mówi po polsku, w jakim stanie jest rezerwacja', async () => {
      bookingFindUnique.mockResolvedValue(existing(BookingStatus.CONFIRMED));

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          message: expect.stringContaining('potwierdzona'),
        },
      );
    });
  });

  // AC #51: nieopłacona zaliczka nie może trafić do kalendarza jako potwierdzona wizyta.
  describe('nieopłacona zaliczka (#51)', () => {
    const unpaid = {
      id: PAYMENT_ID,
      status: PaymentStatus.PENDING,
      stripePaymentIntentId: 'pi_1',
    };

    it('confirm rezerwacji z nieopłaconą zaliczką → 409, bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue({
        ...existing(BookingStatus.PENDING),
        payment: unpaid,
      });

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
          message: 'Rezerwacja czeka na opłacenie zaliczki',
        },
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('confirm przechodzi, gdy zaliczka jest już opłacona', async () => {
      bookingFindUnique.mockResolvedValue({
        ...existing(BookingStatus.PENDING),
        payment: { ...unpaid, status: PaymentStatus.SUCCEEDED },
      });

      await expect(
        service.confirm(OWNER_ID, BOOKING_ID),
      ).resolves.toHaveProperty('status', BookingStatus.CONFIRMED);
      expect(releaseUnpaid).not.toHaveBeenCalled();
    });

    it('decline rezerwacji z nieopłaconą zaliczką unieważnia PaymentIntent', async () => {
      bookingFindUnique.mockResolvedValue({
        ...existing(BookingStatus.PENDING),
        payment: unpaid,
      });

      await service.decline(OWNER_ID, BOOKING_ID);

      // inaczej klient mógłby dokończyć płatność w otwartym formularzu i zapłacić
      // za odrzuconą wizytę
      expect(releaseUnpaid).toHaveBeenCalledWith({
        id: PAYMENT_ID,
        bookingId: BOOKING_ID,
        stripePaymentIntentId: 'pi_1',
      });
    });

    it('błąd unieważnienia nie przewraca już zapisanej decyzji', async () => {
      bookingFindUnique.mockResolvedValue({
        ...existing(BookingStatus.PENDING),
        payment: unpaid,
      });
      releaseUnpaid.mockRejectedValue(new Error('Stripe down'));
      const logError = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      // status jest już w bazie, więc padnięty Stripe ma trafić do logu, a nie w 500;
      // płatność zostaje w PENDING i spróbuje ponownie cron wygaszania
      await expect(
        service.decline(OWNER_ID, BOOKING_ID),
      ).resolves.toHaveProperty('status', BookingStatus.DECLINED);
      expect(logError).toHaveBeenCalled();
      logError.mockRestore();
    });

    it('wyścig: status zmieniony między odczytem a zapisem → 409, nie 500', async () => {
      bookingUpdate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.confirm(OWNER_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
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

describe('BookingsService — odwołania', () => {
  // wizyta 2026-01-14 13:00 lokalnie, polityka 24 h → granica 2026-01-13T12:00:00Z
  const VISIT_STARTS_AT = new Date('2026-01-14T12:00:00.000Z');
  const CANCELLATION_HOURS = 24;
  const DEADLINE = new Date('2026-01-13T12:00:00.000Z');

  let bookingFindUnique: ReturnType<typeof vi.fn>;
  let bookingUpdate: ReturnType<typeof vi.fn>;
  let statusChanged: ReturnType<typeof vi.fn>;
  let releaseUnpaid: ReturnType<typeof vi.fn>;
  let service: BookingsService;

  // rezerwacja klienta CLIENT_ID w firmie właściciela OWNER_ID
  const existing = (status: BookingStatus, payment: unknown = null) => ({
    status,
    clientId: CLIENT_ID,
    startsAt: VISIT_STARTS_AT,
    business: { ownerId: OWNER_ID, cancellationHours: CANCELLATION_HOURS },
    payment,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // domyślnie długo przed granicą polityki
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    bookingFindUnique = vi
      .fn()
      .mockResolvedValue(existing(BookingStatus.CONFIRMED));
    releaseUnpaid = vi.fn().mockResolvedValue(true);
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
      { statusChanged, created: vi.fn() } as unknown as BookingEventsService,
      paymentsMock({ releaseUnpaid }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('klient odwołuje własną rezerwację', () => {
    it('PENDING → CANCELLED_BY_CLIENT', async () => {
      bookingFindUnique.mockResolvedValue(existing(BookingStatus.PENDING));

      const booking = await service.cancel(CLIENT_ID, BOOKING_ID);

      expect(bookingUpdate.mock.calls[0][0].data).toEqual({
        status: BookingStatus.CANCELLED_BY_CLIENT,
      });
      expect(booking).toHaveProperty(
        'status',
        BookingStatus.CANCELLED_BY_CLIENT,
      );
    });

    it('CONFIRMED przed granicą polityki → CANCELLED_BY_CLIENT', async () => {
      vi.setSystemTime(new Date(DEADLINE.getTime() - 1));

      const booking = await service.cancel(CLIENT_ID, BOOKING_ID);

      expect(booking).toHaveProperty(
        'status',
        BookingStatus.CANCELLED_BY_CLIENT,
      );
    });

    it('zapis zawężony statusem odczytanym wcześniej (ochrona przed wyścigiem)', async () => {
      await service.cancel(CLIENT_ID, BOOKING_ID);

      expect(bookingUpdate.mock.calls[0][0].where).toEqual({
        id: BOOKING_ID,
        status: BookingStatus.CONFIRMED,
      });
    });

    it('statusChanged wołany raz, z from i to', async () => {
      const booking = await service.cancel(CLIENT_ID, BOOKING_ID);

      expect(statusChanged).toHaveBeenCalledTimes(1);
      expect(statusChanged).toHaveBeenCalledWith(
        booking,
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED_BY_CLIENT,
      );
    });
  });

  describe('polityka godzinowa (tylko klient, tylko CONFIRMED)', () => {
    // AC #27: „naruszenie polityki → 409 z komunikatem o limicie godzin"
    it('dokładnie X godzin przed startem → 409, bez zapisu', async () => {
      vi.setSystemTime(DEADLINE);

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('po granicy → 409 z komunikatem o limicie godzin', async () => {
      vi.setSystemTime(new Date(DEADLINE.getTime() + 1));

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
          message: expect.stringContaining('24'),
        },
      );
    });

    it('PENDING po granicy i tak przechodzi — okno dotyczy tylko CONFIRMED', async () => {
      bookingFindUnique.mockResolvedValue(existing(BookingStatus.PENDING));
      vi.setSystemTime(new Date(DEADLINE.getTime() + 1));

      await expect(
        service.cancel(CLIENT_ID, BOOKING_ID),
      ).resolves.toHaveProperty('status', BookingStatus.CANCELLED_BY_CLIENT);
    });

    it('firma odwołuje po granicy klienta bez przeszkód', async () => {
      vi.setSystemTime(new Date('2026-01-14T11:00:00.000Z')); // godzina przed wizytą

      await expect(
        service.cancelByBusiness(OWNER_ID, BOOKING_ID),
      ).resolves.toHaveProperty('status', BookingStatus.CANCELLED_BY_BUSINESS);
    });
  });

  describe('firma odwołuje', () => {
    // AC #27: „cancel-by-business działa dla PENDING i CONFIRMED"
    it.each([BookingStatus.PENDING, BookingStatus.CONFIRMED])(
      '%s → CANCELLED_BY_BUSINESS',
      async (status) => {
        bookingFindUnique.mockResolvedValue(existing(status));

        const booking = await service.cancelByBusiness(OWNER_ID, BOOKING_ID);

        expect(bookingUpdate.mock.calls[0][0].data).toEqual({
          status: BookingStatus.CANCELLED_BY_BUSINESS,
        });
        expect(booking).toHaveProperty(
          'status',
          BookingStatus.CANCELLED_BY_BUSINESS,
        );
      },
    );

    it('statusChanged zgłasza przejście do CANCELLED_BY_BUSINESS', async () => {
      await service.cancelByBusiness(OWNER_ID, BOOKING_ID);

      expect(statusChanged).toHaveBeenCalledWith(
        expect.anything(),
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED_BY_BUSINESS,
      );
    });
  });

  describe('uprawnienia', () => {
    it('nieistniejąca rezerwacja → 404, bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue(null);

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 404,
        },
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    // AC #27: „klient odwołuje wyłącznie własne rezerwacje"
    it('cudza rezerwacja → 403, bez zapisu', async () => {
      await expect(
        service.cancel('99999999-9999-4999-8999-999999999999', BOOKING_ID),
      ).rejects.toMatchObject({ status: 403 });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it('właściciel firmy nie odwoła cudzej wizyty przez /cancel — tam liczy się clientId', async () => {
      await expect(service.cancel(OWNER_ID, BOOKING_ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('klient nie odwoła wizyty przez cancel-by-business — tam liczy się właściciel', async () => {
      await expect(
        service.cancelByBusiness(CLIENT_ID, BOOKING_ID),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });
  });

  describe('stany terminalne', () => {
    // AC #27: „DECLINED, CANCELLED_*, COMPLETED nieodwoływalne → 409"
    const TERMINAL = [
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CLIENT,
      BookingStatus.CANCELLED_BY_BUSINESS,
      BookingStatus.COMPLETED,
    ];

    it.each(TERMINAL)('klient: %s → 409, bez zapisu', async (status) => {
      bookingFindUnique.mockResolvedValue(existing(status));

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(statusChanged).not.toHaveBeenCalled();
    });

    it.each(TERMINAL)('firma: %s → 409, bez zapisu', async (status) => {
      bookingFindUnique.mockResolvedValue(existing(status));

      await expect(
        service.cancelByBusiness(OWNER_ID, BOOKING_ID),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    // komunikat ma mówić o stanie rezerwacji, nie o limicie godzin — inaczej klient
    // odwołujący zakończoną wizytę dostałby mylącą podpowiedź „zdążysz następnym razem"
    it('komunikat 409 dla stanu terminalnego mówi o stanie, nie o godzinach', async () => {
      bookingFindUnique.mockResolvedValue(existing(BookingStatus.COMPLETED));

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          message: expect.stringContaining('zakończona'),
        },
      );
    });
  });

  describe('wyścigi', () => {
    it('status zmieniony między odczytem a zapisem → 409, nie 500', async () => {
      bookingUpdate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.cancel(CLIENT_ID, BOOKING_ID)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
      expect(statusChanged).not.toHaveBeenCalled();
    });
  });
});

describe('BookingsService — moje wizyty', () => {
  // czas zamrożony w środku historii: część wizyt jest przed nim, część po
  const NOW = new Date('2026-01-10T10:00:00.000Z');
  const CANCELLATION_HOURS = 24;

  const business = {
    id: BUSINESS_ID,
    slug: 'salon-alexa',
    name: 'Salon Alexa',
    phone: '600100200',
    street: 'Kwiatowa 1',
    city: 'Wrocław',
    postalCode: '50-001',
    cancellationHours: CANCELLATION_HOURS,
  };
  const serviceData = {
    id: SERVICE_ID,
    name: 'Strzyżenie',
    description: null,
    durationMin: 60,
    priceCents: 8000,
  };
  const employee = { id: EMPLOYEE_ID, name: 'Ala' };

  const booking = (
    startsAt: string,
    status: BookingStatus,
    id = BOOKING_ID,
  ) => ({
    id,
    startsAt: new Date(startsAt),
    endsAt: addMinutes(new Date(startsAt), serviceData.durationMin),
    status,
    clientNote: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    business,
    service: serviceData,
    employee,
  });

  type BookingRow = ReturnType<typeof booking>;
  type FindManyArgs = { where: { endsAt: { gt?: Date; lte?: Date } } };

  let findMany: ReturnType<typeof vi.fn>;
  let service: BookingsService;

  // jeden mock na oba zapytania — rozdziela je warunek na endsAt (gt = nadchodzące)
  const respond = (upcoming: BookingRow[], past: BookingRow[]) =>
    findMany.mockImplementation(({ where }: FindManyArgs) =>
      Promise.resolve(where.endsAt.gt ? upcoming : past),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    findMany = vi.fn().mockResolvedValue([]);
    service = new BookingsService(
      { booking: { findMany } } as unknown as PrismaService,
      eventsMock(),
      paymentsMock(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // pomocniczo: argumenty zapytania o daną grupę, niezależnie od kolejności wywołań
  const argsFor = (group: 'upcoming' | 'past') =>
    findMany.mock.calls
      .map((call) => call[0] as FindManyArgs)
      .find((args) =>
        group === 'upcoming' ? args.where.endsAt.gt : args.where.endsAt.lte,
      );

  describe('zakres i sortowanie', () => {
    // AC: „sortowanie: nadchodzące rosnąco, minione malejąco"
    it('nadchodzące: endsAt > now, rosnąco po startsAt, tylko własne', async () => {
      await service.findMine(CLIENT_ID);

      expect(argsFor('upcoming')).toMatchObject({
        where: { clientId: CLIENT_ID, endsAt: { gt: NOW } },
        orderBy: { startsAt: 'asc' },
      });
    });

    it('minione: endsAt <= now, malejąco po startsAt, tylko własne', async () => {
      await service.findMine(CLIENT_ID);

      expect(argsFor('past')).toMatchObject({
        where: { clientId: CLIENT_ID, endsAt: { lte: NOW } },
        orderBy: { startsAt: 'desc' },
      });
    });

    it('obie grupy pytane jednym znacznikiem czasu — bez dziury między zapytaniami', async () => {
      await service.findMine(CLIENT_ID);

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(argsFor('past')?.where.endsAt.lte).toEqual(
        argsFor('upcoming')?.where.endsAt.gt,
      );
    });

    // AC #41: „istniejące rezerwacje zablokowanej firmy pozostają widoczne dla klientów
    // w moich wizytach". Blokada wycina firmę z wyszukiwarki i z POST /bookings, ale nie
    // z historii klienta — dlatego w tym where celowo NIE ma warunku na isBlocked.
    it('nie zawęża po statusie blokady firmy — wizyty zablokowanej firmy zostają na liście', async () => {
      await service.findMine(CLIENT_ID);

      for (const group of ['upcoming', 'past'] as const) {
        const { where } = argsFor(group) as FindManyArgs;
        expect(where).not.toHaveProperty('business');
        expect(where).not.toHaveProperty('isBlocked');
        // pełna lista warunków, żeby przyszły filtr nie wślizgnął się niezauważony
        expect(Object.keys(where).sort()).toEqual(['clientId', 'endsAt']);
      }
    });

    it('kolejność z bazy zostaje zachowana w odpowiedzi', async () => {
      respond(
        [
          booking('2026-01-11T09:00:00.000Z', BookingStatus.CONFIRMED, 'b-1'),
          booking('2026-01-20T09:00:00.000Z', BookingStatus.PENDING, 'b-2'),
        ],
        [booking('2026-01-05T09:00:00.000Z', BookingStatus.COMPLETED, 'b-3')],
      );

      const result = await service.findMine(CLIENT_ID);

      expect(result.upcoming.map((b) => b.id)).toEqual(['b-1', 'b-2']);
      expect(result.past.map((b) => b.id)).toEqual(['b-3']);
    });
  });

  describe('dane karty wizyty', () => {
    // AC: „komplet danych do wyświetlenia karty wizyty (firma, usługa, pracownik, status, czasy)"
    it('zwraca firmę, usługę, pracownika, status i czasy', async () => {
      const row = booking('2026-01-20T09:00:00.000Z', BookingStatus.CONFIRMED);
      respond([row], []);

      const [visit] = (await service.findMine(CLIENT_ID)).upcoming;

      expect(visit).toMatchObject({
        id: row.id,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        status: BookingStatus.CONFIRMED,
        business,
        service: serviceData,
        employee,
      });
    });

    it('select nie sięga po pola prywatne firmy ani po clientId', async () => {
      await service.findMine(CLIENT_ID);

      const { select } = findMany.mock.calls[0][0];
      expect(select).not.toHaveProperty('clientId');
      expect(select.business.select).not.toHaveProperty('ownerId');
      expect(select.business.select).not.toHaveProperty('isBlocked');
    });

    // #47/#48: bez tego pola front nie odróżni odbytej wizyty bez oceny od już ocenionej
    it('pobiera wystawioną recenzję razem z wizytą', async () => {
      await service.findMine(CLIENT_ID);

      const { select } = findMany.mock.calls[0][0];
      expect(select.review.select).toEqual({
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
      });
    });
  });

  describe('flaga canCancel', () => {
    // AC: „flaga per rezerwacja, czy odwołanie jest jeszcze możliwe wg polityki”.
    // Musi zgadzać się z tym, co zrobi POST /bookings/:id/cancel (#27).
    it('CONFIRMED przed granicą polityki → true', async () => {
      // start 2026-01-20 09:00Z, polityka 24 h → granica 2026-01-19 09:00Z, czyli po NOW
      respond(
        [booking('2026-01-20T09:00:00.000Z', BookingStatus.CONFIRMED)],
        [],
      );

      const [visit] = (await service.findMine(CLIENT_ID)).upcoming;

      expect(visit.canCancel).toBe(true);
    });

    it('CONFIRMED dokładnie X godzin przed startem → false', async () => {
      // granica należy do firmy: o tej samej sekundzie /cancel zwraca 409
      respond(
        [booking('2026-01-11T10:00:00.000Z', BookingStatus.CONFIRMED)],
        [],
      );

      const [visit] = (await service.findMine(CLIENT_ID)).upcoming;

      expect(visit.canCancel).toBe(false);
    });

    it('PENDING po granicy polityki → true, okno dotyczy tylko CONFIRMED', async () => {
      respond([booking('2026-01-10T18:00:00.000Z', BookingStatus.PENDING)], []);

      const [visit] = (await service.findMine(CLIENT_ID)).upcoming;

      expect(visit.canCancel).toBe(true);
    });

    it.each([
      BookingStatus.COMPLETED,
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CLIENT,
      BookingStatus.CANCELLED_BY_BUSINESS,
    ])('stan terminalny %s → false', async (status) => {
      respond([], [booking('2026-01-05T09:00:00.000Z', status)]);

      const [visit] = (await service.findMine(CLIENT_ID)).past;

      expect(visit.canCancel).toBe(false);
    });

    it('flaga liczona per rezerwacja, nie raz na listę', async () => {
      respond(
        [
          booking('2026-01-20T09:00:00.000Z', BookingStatus.CONFIRMED, 'b-1'),
          booking('2026-01-11T10:00:00.000Z', BookingStatus.CONFIRMED, 'b-2'),
        ],
        [],
      );

      const { upcoming } = await service.findMine(CLIENT_ID);

      expect(upcoming.map((b) => b.canCancel)).toEqual([true, false]);
    });
  });
});

describe('BookingsService — kalendarz firmy (#31)', () => {
  const ownerUser: AuthUser = {
    sub: OWNER_ID,
    email: 'owner@example.com',
    role: UserRole.OWNER,
  };
  const employeeUser: AuthUser = {
    sub: EMPLOYEE_USER_ID,
    email: 'pracownik@example.com',
    role: UserRole.EMPLOYEE,
  };

  // zimowa środa — spójna ze strefą Europe/Warsaw użytą w innych testach tego pliku
  const query = (
    overrides: Partial<{ from: string; to: string; employeeId: string }> = {},
  ) => ({
    from: '2026-01-14',
    to: '2026-01-14',
    ...overrides,
  });

  let businessFindUnique: ReturnType<typeof vi.fn>;
  let employeeFindUnique: ReturnType<typeof vi.fn>;
  let bookingFindMany: ReturnType<typeof vi.fn>;
  let service: BookingsService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: BUSINESS_ID });
    employeeFindUnique = vi
      .fn()
      .mockResolvedValue({ id: EMPLOYEE_ID, businessId: BUSINESS_ID });
    bookingFindMany = vi.fn().mockResolvedValue([]);

    service = new BookingsService(
      {
        business: { findUnique: businessFindUnique },
        employee: { findUnique: employeeFindUnique },
        booking: { findMany: bookingFindMany },
      } as unknown as PrismaService,
      eventsMock(),
      paymentsMock(),
    );
  });

  it('OWNER: zwraca rezerwacje całej firmy w zakresie, posortowane po startsAt', async () => {
    await service.findForBusiness(ownerUser, query());

    expect(businessFindUnique).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID },
      select: { id: true },
    });
    const { startUtc } = localDayRangeUtc(parseLocalDate('2026-01-14'));
    const { endUtc } = localDayRangeUtc(parseLocalDate('2026-01-14'));
    expect(bookingFindMany).toHaveBeenCalledWith({
      where: {
        startsAt: { lt: endUtc },
        endsAt: { gt: startUtc },
        businessId: BUSINESS_ID,
      },
      orderBy: { startsAt: 'asc' },
      select: expect.any(Object),
    });
  });

  it('OWNER + employeeId: zawęża where do wskazanego pracownika', async () => {
    await service.findForBusiness(
      ownerUser,
      query({ employeeId: OTHER_EMPLOYEE_ID }),
    );

    expect(bookingFindMany.mock.calls[0][0].where).toMatchObject({
      businessId: BUSINESS_ID,
      employeeId: OTHER_EMPLOYEE_ID,
    });
  });

  it('OWNER bez employeeId: where nie zawiera filtra pracownika', async () => {
    await service.findForBusiness(ownerUser, query());

    expect(bookingFindMany.mock.calls[0][0].where).not.toHaveProperty(
      'employeeId',
    );
  });

  it('EMPLOYEE: filtr employeeId wymuszony serwerowo na własnym pracowniku, query ignorowane', async () => {
    await service.findForBusiness(
      employeeUser,
      query({ employeeId: OTHER_EMPLOYEE_ID }),
    );

    expect(employeeFindUnique).toHaveBeenCalledWith({
      where: { userId: EMPLOYEE_USER_ID },
      select: { id: true, businessId: true },
    });
    expect(bookingFindMany.mock.calls[0][0].where).toMatchObject({
      businessId: BUSINESS_ID,
      employeeId: EMPLOYEE_ID,
    });
    expect(businessFindUnique).not.toHaveBeenCalled();
  });

  it('to przed from → 400, bez zapytań do bazy', async () => {
    await expect(
      service.findForBusiness(
        ownerUser,
        query({ from: '2026-01-15', to: '2026-01-14' }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(
      service.findForBusiness(ownerUser, query()),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('EMPLOYEE bez powiązanego rekordu pracownika → 404', async () => {
    employeeFindUnique.mockResolvedValue(null);

    await expect(
      service.findForBusiness(employeeUser, query()),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
