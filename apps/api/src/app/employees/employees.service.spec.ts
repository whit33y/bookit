import { Prisma, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
  });

describe('EmployeesService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let userUpdate: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let prisma: {
    business: { findUnique: typeof businessFindUnique };
    user: { findUnique: typeof userFindUnique; update: typeof userUpdate };
    employee: {
      findMany: typeof findMany;
      findFirst: typeof findFirst;
      create: typeof create;
      update: typeof update;
      delete: typeof remove;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: EmployeesService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    userFindUnique = vi.fn();
    userUpdate = vi.fn().mockResolvedValue({ id: 'u1' });
    findMany = vi.fn();
    findFirst = vi.fn();
    create = vi.fn();
    update = vi.fn();
    remove = vi.fn();
    prisma = {
      business: { findUnique: businessFindUnique },
      user: { findUnique: userFindUnique, update: userUpdate },
      employee: { findMany, findFirst, create, update, delete: remove },
      // tx = ten sam mock, wykonujemy callback od razu
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new EmployeesService(prisma as unknown as PrismaService);
  });

  it('findAll zwraca pracowników firmy (także nieaktywnych) scope po businessId', async () => {
    findMany.mockResolvedValue([{ id: 'e1' }]);

    const result = await service.findAll('user-1');

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ businessId: 'b1' });
    expect(arg.where.isActive).toBeUndefined();
    expect(result).toEqual([{ id: 'e1' }]);
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(service.findAll('user-1')).rejects.toMatchObject({ status: 404 });
  });

  it('create bez email → userId null, brak zmiany roli', async () => {
    create.mockResolvedValue({ id: 'e1' });

    await service.create('user-1', { name: 'Anna' });

    expect(create.mock.calls[0][0].data).toEqual({
      businessId: 'b1',
      name: 'Anna',
      userId: null,
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('create z email CLIENT → powiązanie + rola EMPLOYEE', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', role: UserRole.CLIENT });
    create.mockResolvedValue({ id: 'e1' });

    await service.create('user-1', { name: 'Anna', email: 'a@b.pl' });

    expect(create.mock.calls[0][0].data.userId).toBe('u1');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: UserRole.EMPLOYEE },
    });
  });

  it('create z nieistniejącym email → 400', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      service.create('user-1', { name: 'Anna', email: 'x@b.pl' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('create z email właściciela → 400 (nie nadpisujemy roli)', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', role: UserRole.OWNER });

    await expect(
      service.create('user-1', { name: 'Anna', email: 'owner@b.pl' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('create gdy user jest już pracownikiem (P2002) → 400', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', role: UserRole.CLIENT });
    create.mockRejectedValue(prismaError('P2002'));

    await expect(
      service.create('user-1', { name: 'Anna', email: 'a@b.pl' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('update cudzego/nieistniejącego pracownika → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.update('user-1', 'e1', { name: 'Nowe' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'e1', businessId: 'b1' });
  });

  it('update zwraca odświeżonego pracownika', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: null });
    update.mockResolvedValue({ id: 'e1', name: 'Nowe' });

    const result = await service.update('user-1', 'e1', { name: 'Nowe' });

    expect(result).toEqual({ id: 'e1', name: 'Nowe' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('update z email → nowy user EMPLOYEE, userId ustawiony', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: null });
    userFindUnique.mockResolvedValue({ id: 'u2', role: UserRole.CLIENT });
    update.mockResolvedValue({ id: 'e1' });

    await service.update('user-1', 'e1', { email: 'nowy@b.pl' });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { role: UserRole.EMPLOYEE },
    });
    expect(update.mock.calls[0][0].data.userId).toBe('u2');
  });

  it('update przepina na inne konto → poprzedni user wraca do CLIENT', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: 'u1' });
    userFindUnique.mockResolvedValue({ id: 'u2', role: UserRole.CLIENT });
    update.mockResolvedValue({ id: 'e1' });

    await service.update('user-1', 'e1', { email: 'nowy@b.pl' });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { role: UserRole.EMPLOYEE },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: UserRole.CLIENT },
    });
  });

  it('remove z rezerwacjami → dezaktywacja (isActive:false), bez delete, rola zostaje', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: 'u1', _count: { bookings: 2 } });
    update.mockResolvedValue({ id: 'e1', isActive: false });

    const result = await service.remove('user-1', 'e1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(remove).not.toHaveBeenCalled();
    // dezaktywacja zostawia powiązanie i rolę EMPLOYEE
    expect(userUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'e1', isActive: false, deactivated: true });
  });

  it('remove bez rezerwacji → twarde usunięcie', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: null, _count: { bookings: 0 } });
    remove.mockResolvedValue({ id: 'e1' });

    const result = await service.remove('user-1', 'e1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 'e1' } });
    expect(update).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'e1', deactivated: false });
  });

  it('remove z powiązanym kontem → delete + cofnięcie roli usera do CLIENT', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: 'u1', _count: { bookings: 0 } });
    remove.mockResolvedValue({ id: 'e1' });

    await service.remove('user-1', 'e1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 'e1' } });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: UserRole.CLIENT },
    });
  });

  it('wyścig: delete rzuca P2003 → dezaktywacja zamiast 500', async () => {
    findFirst.mockResolvedValue({ id: 'e1', userId: null, _count: { bookings: 0 } });
    remove.mockRejectedValue(prismaError('P2003'));
    update.mockResolvedValue({ id: 'e1', isActive: false });

    const result = await service.remove('user-1', 'e1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(result).toEqual({ id: 'e1', isActive: false, deactivated: true });
  });

  it('remove cudzego/nieistniejącego → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.remove('user-1', 'e1')).rejects.toMatchObject({ status: 404 });
  });
});
