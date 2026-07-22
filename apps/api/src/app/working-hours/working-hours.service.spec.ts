import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { WorkingHoursService } from './working-hours.service';

describe('WorkingHoursService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let employeeFindFirst: ReturnType<typeof vi.fn>;
  let whFindMany: ReturnType<typeof vi.fn>;
  let whDeleteMany: ReturnType<typeof vi.fn>;
  let whCreateMany: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let prisma: {
    business: { findUnique: typeof businessFindUnique };
    employee: { findFirst: typeof employeeFindFirst };
    workingHours: {
      findMany: typeof whFindMany;
      deleteMany: typeof whDeleteMany;
      createMany: typeof whCreateMany;
    };
    $transaction: typeof transaction;
  };
  let service: WorkingHoursService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    employeeFindFirst = vi.fn().mockResolvedValue({ id: 'e1' });
    whFindMany = vi.fn().mockResolvedValue([]);
    whDeleteMany = vi.fn().mockReturnValue('DEL');
    whCreateMany = vi.fn().mockReturnValue('CREATE');
    transaction = vi.fn().mockResolvedValue(undefined);
    prisma = {
      business: { findUnique: businessFindUnique },
      employee: { findFirst: employeeFindFirst },
      workingHours: { findMany: whFindMany, deleteMany: whDeleteMany, createMany: whCreateMany },
      $transaction: transaction,
    };
    service = new WorkingHoursService(prisma as unknown as PrismaService);
  });

  const put = (slots: { weekday: number; startTime: string; endTime: string }[]) =>
    service.setSchedule('user-1', 'e1', { slots });

  it('PUT zastępuje grafik atomowo: deleteMany + createMany w jednej transakcji', async () => {
    await put([{ weekday: 0, startTime: '09:00', endTime: '13:00' }]);

    expect(whDeleteMany).toHaveBeenCalledWith({ where: { employeeId: 'e1' } });
    expect(whCreateMany).toHaveBeenCalledWith({
      data: [{ employeeId: 'e1', weekday: 0, startTime: '09:00', endTime: '13:00' }],
    });
    // obie operacje przekazane razem do $transaction (atomowo)
    expect(transaction).toHaveBeenCalledWith(['DEL', 'CREATE']);
  });

  it('dwa rozłączne przedziały tego samego dnia (9–13, 15–19) → OK', async () => {
    await expect(
      put([
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '15:00', endTime: '19:00' },
      ]),
    ).resolves.toBeDefined();
    expect(transaction).toHaveBeenCalled();
  });

  it('startTime >= endTime → 400, bez zapisu', async () => {
    await expect(
      put([{ weekday: 0, startTime: '13:00', endTime: '09:00' }]),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('nachodzące przedziały tego samego dnia → 400', async () => {
    await expect(
      put([
        { weekday: 2, startTime: '09:00', endTime: '13:00' },
        { weekday: 2, startTime: '12:00', endTime: '16:00' },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('ten sam czas w różnych dniach nie jest kolizją → OK', async () => {
    await expect(
      put([
        { weekday: 0, startTime: '09:00', endTime: '17:00' },
        { weekday: 1, startTime: '09:00', endTime: '17:00' },
      ]),
    ).resolves.toBeDefined();
  });

  it('pracownik z innej firmy / nieistniejący → 404', async () => {
    employeeFindFirst.mockResolvedValue(null);

    await expect(put([])).rejects.toMatchObject({ status: 404 });
    await expect(service.getSchedule('user-1', 'e1')).rejects.toMatchObject({ status: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(service.getSchedule('user-1', 'e1')).rejects.toMatchObject({ status: 404 });
  });

  it('getSchedule zwraca 7 dni, sloty pogrupowane po weekday', async () => {
    whFindMany.mockResolvedValue([
      { weekday: 0, startTime: '09:00', endTime: '13:00' },
      { weekday: 0, startTime: '15:00', endTime: '19:00' },
      { weekday: 3, startTime: '10:00', endTime: '18:00' },
    ]);

    const result = await service.getSchedule('user-1', 'e1');

    expect(result).toHaveLength(7);
    expect(result[0]).toEqual({
      weekday: 0,
      slots: [
        { startTime: '09:00', endTime: '13:00' },
        { startTime: '15:00', endTime: '19:00' },
      ],
    });
    expect(result[1].slots).toEqual([]);
    expect(result[3].slots).toEqual([{ startTime: '10:00', endTime: '18:00' }]);
  });
});
