import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { TimeOffsService } from './time-offs.service';

describe('TimeOffsService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let employeeFindFirst: ReturnType<typeof vi.fn>;
  let toFindMany: ReturnType<typeof vi.fn>;
  let toCreate: ReturnType<typeof vi.fn>;
  let toDeleteMany: ReturnType<typeof vi.fn>;
  let prisma: {
    business: { findUnique: typeof businessFindUnique };
    employee: { findFirst: typeof employeeFindFirst };
    timeOff: {
      findMany: typeof toFindMany;
      create: typeof toCreate;
      deleteMany: typeof toDeleteMany;
    };
  };
  let service: TimeOffsService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    employeeFindFirst = vi.fn().mockResolvedValue({ id: 'e1' });
    toFindMany = vi.fn().mockResolvedValue([]);
    toCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }));
    toDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    prisma = {
      business: { findUnique: businessFindUnique },
      employee: { findFirst: employeeFindFirst },
      timeOff: { findMany: toFindMany, create: toCreate, deleteMany: toDeleteMany },
    };
    service = new TimeOffsService(prisma as unknown as PrismaService);
  });

  const create = (startsAt: string, endsAt: string, reason?: string) =>
    service.create('user-1', 'e1', { startsAt, endsAt, reason });

  it('poprawny przedział → tworzy urlop i zwraca rekord', async () => {
    const result = await create('2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', 'wakacje');

    expect(toCreate).toHaveBeenCalledWith({
      data: {
        employeeId: 'e1',
        startsAt: new Date('2026-08-01T00:00:00Z'),
        endsAt: new Date('2026-08-05T00:00:00Z'),
        reason: 'wakacje',
      },
      select: expect.anything(),
    });
    expect(result).toMatchObject({ id: 't1', reason: 'wakacje' });
  });

  it('brak reason → zapisuje null', async () => {
    await create('2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z');
    expect(toCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: null }) }),
    );
  });

  it('startsAt >= endsAt → 400, bez zapisu', async () => {
    await expect(
      create('2026-08-05T00:00:00Z', '2026-08-01T00:00:00Z'),
    ).rejects.toMatchObject({ status: 400 });
    expect(toCreate).not.toHaveBeenCalled();
  });

  it('startsAt === endsAt → 400', async () => {
    await expect(
      create('2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    ).rejects.toMatchObject({ status: 400 });
    expect(toCreate).not.toHaveBeenCalled();
  });

  it('pracownik z innej firmy / nieistniejący → 404 (list, create, remove)', async () => {
    employeeFindFirst.mockResolvedValue(null);

    await expect(service.list('user-1', 'e1')).rejects.toMatchObject({ status: 404 });
    await expect(
      create('2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('user-1', 'e1', 't1')).rejects.toMatchObject({ status: 404 });
    expect(toCreate).not.toHaveBeenCalled();
    expect(toDeleteMany).not.toHaveBeenCalled();
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);
    await expect(service.list('user-1', 'e1')).rejects.toMatchObject({ status: 404 });
  });

  it('list filtruje po endsAt >= teraz i sortuje po startsAt', async () => {
    const before = Date.now();
    await service.list('user-1', 'e1');
    const arg = toFindMany.mock.calls[0][0];

    expect(arg.where.employeeId).toBe('e1');
    expect(arg.where.endsAt.gte).toBeInstanceOf(Date);
    expect(arg.where.endsAt.gte.getTime()).toBeGreaterThanOrEqual(before);
    expect(arg.orderBy).toEqual({ startsAt: 'asc' });
  });

  it('remove istniejącego urlopu → scope po employeeId, zwraca id', async () => {
    const result = await service.remove('user-1', 'e1', 't1');
    expect(toDeleteMany).toHaveBeenCalledWith({ where: { id: 't1', employeeId: 'e1' } });
    expect(result).toEqual({ id: 't1' });
  });

  it('remove nieistniejącego urlopu (count 0) → 404', async () => {
    toDeleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('user-1', 'e1', 'nope')).rejects.toMatchObject({ status: 404 });
  });
});
