import { BookingStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

// zimowa środa: 2026-01-14 (weekday 2 w konwencji Prismy), CET → 09:00 lokalnie = 08:00Z
const DATE = '2026-01-14';
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMPLOYEE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('AvailabilityService', () => {
  let businessFindFirst: ReturnType<typeof vi.fn>;
  let serviceFindFirst: ReturnType<typeof vi.fn>;
  let whFindMany: ReturnType<typeof vi.fn>;
  let timeOffFindMany: ReturnType<typeof vi.fn>;
  let bookingFindMany: ReturnType<typeof vi.fn>;
  let service: AvailabilityService;

  beforeEach(() => {
    // czas zamrożony przed liczonym dniem, żeby filtr przeszłości nie zjadał slotów
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    businessFindFirst = vi.fn().mockResolvedValue({ id: 'biz-1' });
    serviceFindFirst = vi.fn().mockResolvedValue({
      durationMin: 60,
      employees: [{ id: EMPLOYEE_A }],
    });
    whFindMany = vi
      .fn()
      .mockResolvedValue([
        { employeeId: EMPLOYEE_A, startTime: '09:00', endTime: '11:00' },
      ]);
    timeOffFindMany = vi.fn().mockResolvedValue([]);
    bookingFindMany = vi.fn().mockResolvedValue([]);

    service = new AvailabilityService({
      business: { findFirst: businessFindFirst },
      service: { findFirst: serviceFindFirst },
      workingHours: { findMany: whFindMany },
      timeOff: { findMany: timeOffFindMany },
      booking: { findMany: bookingFindMany },
    } as unknown as PrismaService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const get = (overrides: { employeeId?: string; date?: string } = {}) =>
    service.getSlots('salon-x', {
      serviceId: SERVICE_ID,
      date: overrides.date ?? DATE,
      employeeId: overrides.employeeId,
    });

  it('zwraca sloty jako ISO 8601 w UTC', async () => {
    const slots = await get();

    // 09:00–11:00 lokalnie (CET), usługa 60 min → starty 09:00, 09:15 … 10:00
    expect(slots).toEqual([
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T08:00:00.000Z' },
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T08:15:00.000Z' },
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T08:30:00.000Z' },
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T08:45:00.000Z' },
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T09:00:00.000Z' },
    ]);
  });

  it('bez employeeId → sloty wszystkich aktywnych pracowników wykonujących usługę', async () => {
    serviceFindFirst.mockResolvedValue({
      durationMin: 60,
      employees: [{ id: EMPLOYEE_A }, { id: EMPLOYEE_B }],
    });
    whFindMany.mockResolvedValue([
      { employeeId: EMPLOYEE_A, startTime: '09:00', endTime: '10:00' },
      { employeeId: EMPLOYEE_B, startTime: '09:00', endTime: '10:00' },
    ]);

    const slots = await get();

    expect(slots).toEqual([
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T08:00:00.000Z' },
      { employeeId: EMPLOYEE_B, startsAt: '2026-01-14T08:00:00.000Z' },
    ]);
    // tylko aktywni pracownicy, bez zawężania po id
    expect(serviceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SERVICE_ID, businessId: 'biz-1', isActive: true },
        select: expect.objectContaining({
          employees: { where: { isActive: true }, select: { id: true } },
        }),
      }),
    );
  });

  it('z employeeId → zapytanie zawężone do tego pracownika', async () => {
    await get({ employeeId: EMPLOYEE_A });

    expect(serviceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          employees: { where: { isActive: true, id: EMPLOYEE_A }, select: { id: true } },
        }),
      }),
    );
  });

  it('grafiki, urlopy i rezerwacje pobierane jednym strzałem dla wszystkich pracowników', async () => {
    serviceFindFirst.mockResolvedValue({
      durationMin: 60,
      employees: [{ id: EMPLOYEE_A }, { id: EMPLOYEE_B }],
    });

    await get();

    const employeeIn = { in: [EMPLOYEE_A, EMPLOYEE_B] };
    expect(whFindMany).toHaveBeenCalledTimes(1);
    expect(whFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: employeeIn, weekday: 2 } }),
    );
    expect(timeOffFindMany).toHaveBeenCalledTimes(1);
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
  });

  it('pobiera tylko rezerwacje PENDING i CONFIRMED, nachodzące na dobę lokalną', async () => {
    await get();

    expect(bookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId: { in: [EMPLOYEE_A] },
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          // doba lokalna 2026-01-14 w CET → [23:00Z 13.01, 23:00Z 14.01)
          startsAt: { lt: new Date('2026-01-14T23:00:00.000Z') },
          endsAt: { gt: new Date('2026-01-13T23:00:00.000Z') },
        },
        select: { employeeId: true, startsAt: true, endsAt: true },
      }),
    );
  });

  it('rezerwacja PENDING blokuje slot tak samo jak CONFIRMED', async () => {
    bookingFindMany.mockResolvedValue([
      {
        employeeId: EMPLOYEE_A,
        startsAt: new Date('2026-01-14T08:00:00.000Z'), // 09:00 lokalnie
        endsAt: new Date('2026-01-14T09:00:00.000Z'),
      },
    ]);

    const slots = await get();

    expect(slots).toEqual([
      { employeeId: EMPLOYEE_A, startsAt: '2026-01-14T09:00:00.000Z' }, // 10:00 — styk
    ]);
  });

  it('urlop wchodzący w dobę z poprzedniego dnia wycina sloty', async () => {
    timeOffFindMany.mockResolvedValue([
      {
        employeeId: EMPLOYEE_A,
        startsAt: new Date('2026-01-13T12:00:00.000Z'),
        endsAt: new Date('2026-01-14T08:45:00.000Z'), // 09:45 lokalnie
      },
    ]);

    const slots = await get();

    expect(slots.map((s) => s.startsAt)).toEqual([
      '2026-01-14T08:45:00.000Z',
      '2026-01-14T09:00:00.000Z',
    ]);
  });

  it('sloty w przeszłości odfiltrowane', async () => {
    vi.setSystemTime(new Date('2026-01-14T08:30:00.000Z')); // 09:30 lokalnie

    const slots = await get();

    expect(slots.map((s) => s.startsAt)).toEqual([
      '2026-01-14T08:30:00.000Z',
      '2026-01-14T08:45:00.000Z',
      '2026-01-14T09:00:00.000Z',
    ]);
  });

  it('firma zablokowana lub nieistniejąca → 404, bez dalszych zapytań', async () => {
    businessFindFirst.mockResolvedValue(null);

    await expect(get()).rejects.toMatchObject({ status: 404 });
    expect(businessFindFirst).toHaveBeenCalledWith({
      where: { slug: 'salon-x', isBlocked: false },
      select: { id: true },
    });
    expect(serviceFindFirst).not.toHaveBeenCalled();
  });

  it('usługa nieaktywna, nieistniejąca lub z innej firmy → 404', async () => {
    serviceFindFirst.mockResolvedValue(null);

    await expect(get()).rejects.toMatchObject({ status: 404 });
    expect(whFindMany).not.toHaveBeenCalled();
  });

  it('employeeId spoza usługi lub nieaktywny → 404', async () => {
    serviceFindFirst.mockResolvedValue({ durationMin: 60, employees: [] });

    await expect(get({ employeeId: EMPLOYEE_B })).rejects.toMatchObject({ status: 404 });
    expect(whFindMany).not.toHaveBeenCalled();
  });

  it('usługa bez przypisanych pracowników (bez employeeId) → pusta lista, nie 404', async () => {
    serviceFindFirst.mockResolvedValue({ durationMin: 60, employees: [] });

    await expect(get()).resolves.toEqual([]);
    expect(whFindMany).not.toHaveBeenCalled();
  });

  it('brak grafiku na ten dzień tygodnia → pusta lista', async () => {
    whFindMany.mockResolvedValue([]);

    await expect(get()).resolves.toEqual([]);
  });

  it('data nieistniejąca w kalendarzu → 400, bez zapytań do bazy', async () => {
    await expect(get({ date: '2026-02-30' })).rejects.toMatchObject({ status: 400 });
    expect(businessFindFirst).not.toHaveBeenCalled();
  });
});
