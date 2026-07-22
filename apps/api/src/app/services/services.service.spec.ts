import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

const dto: CreateServiceDto = {
  name: 'Strzyżenie',
  durationMin: 30,
  priceCents: 5000,
};

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
  });

describe('ServicesService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let employeeCount: ReturnType<typeof vi.fn>;
  let service: ServicesService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    findMany = vi.fn();
    findFirst = vi.fn();
    findUnique = vi.fn();
    create = vi.fn();
    updateMany = vi.fn();
    update = vi.fn();
    remove = vi.fn();
    employeeCount = vi.fn();
    const prisma = {
      business: { findUnique: businessFindUnique },
      service: { findMany, findFirst, findUnique, create, updateMany, update, delete: remove },
      employee: { count: employeeCount },
    };
    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('findAll zwraca wszystkie usługi firmy (także nieaktywne) z pracownikami, scope po businessId', async () => {
    findMany.mockResolvedValue([{ id: 's1', employees: [{ id: 'e1', name: 'Ala' }] }]);

    const result = await service.findAll('user-1');

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ businessId: 'b1' });
    // brak filtra isActive — widok właściciela pokazuje też dezaktywowane
    expect(arg.where.isActive).toBeUndefined();
    // select niesie przypisanych pracowników (panel #21 wypełnia multi-select)
    expect(arg.select.employees).toBeDefined();
    expect(result).toEqual([{ id: 's1', employees: [{ id: 'e1', name: 'Ala' }] }]);
  });

  it('create dokłada businessId z tokena, nie z body', async () => {
    create.mockResolvedValue({ id: 's1' });

    await service.create('user-1', dto);

    expect(create.mock.calls[0][0].data).toEqual({ ...dto, businessId: 'b1' });
  });

  it('OWNER bez firmy → 404', async () => {
    businessFindUnique.mockResolvedValue(null);

    await expect(service.findAll('user-1')).rejects.toMatchObject({ status: 404 });
  });

  it('update scope po businessId; brak trafienia (cudza usługa) → 404', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update('user-1', 's1', { priceCents: 999 })).rejects.toMatchObject({
      status: 404,
    });
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 's1', businessId: 'b1' });
  });

  it('update zwraca odświeżoną usługę po udanej edycji', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 's1', priceCents: 999 });

    const result = await service.update('user-1', 's1', { priceCents: 999 });

    expect(result).toEqual({ id: 's1', priceCents: 999 });
  });

  it('remove z rezerwacjami → dezaktywacja (isActive:false), bez delete', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 3 } });
    update.mockResolvedValue({ id: 's1', isActive: false });

    const result = await service.remove('user-1', 's1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 's1', isActive: false, deactivated: true });
  });

  it('remove bez rezerwacji → twarde usunięcie', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 0 } });
    remove.mockResolvedValue({ id: 's1' });

    const result = await service.remove('user-1', 's1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 's1', deactivated: false });
  });

  it('wyścig: rezerwacja po zliczeniu → delete rzuca P2003 → dezaktywacja zamiast 500', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 0 } });
    remove.mockRejectedValue(prismaError('P2003'));
    update.mockResolvedValue({ id: 's1', isActive: false });

    const result = await service.remove('user-1', 's1');

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(result).toEqual({ id: 's1', isActive: false, deactivated: true });
  });

  it('remove cudzej/nieistniejącej usługi → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.remove('user-1', 's1')).rejects.toMatchObject({ status: 404 });
  });

  it('setEmployees ustawia pracowników (replace) scope po businessId', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    employeeCount.mockResolvedValue(2);
    update.mockResolvedValue({ id: 's1', employees: [{ id: 'e1' }, { id: 'e2' }] });

    const result = await service.setEmployees('user-1', 's1', ['e1', 'e2']);

    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 's1', businessId: 'b1' });
    expect(employeeCount.mock.calls[0][0].where).toEqual({
      id: { in: ['e1', 'e2'] },
      businessId: 'b1',
    });
    expect(update.mock.calls[0][0].data).toEqual({
      employees: { set: [{ id: 'e1' }, { id: 'e2' }] },
    });
    expect(result).toEqual({ id: 's1', employees: [{ id: 'e1' }, { id: 'e2' }] });
  });

  it('setEmployees z pracownikiem spoza firmy/nieistniejącym → 400', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    // dwa id, ale tylko jeden należy do firmy
    employeeCount.mockResolvedValue(1);

    await expect(
      service.setEmployees('user-1', 's1', ['e1', 'obcy']),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('setEmployees na cudzej/nieistniejącej usłudze → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.setEmployees('user-1', 's1', ['e1']),
    ).rejects.toMatchObject({ status: 404 });
    expect(employeeCount).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('setEmployees: wyścig — set rzuca P2025 (pracownik usunięty) → 400 zamiast 500', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    employeeCount.mockResolvedValue(1);
    update.mockRejectedValue(prismaError('P2025'));

    await expect(
      service.setEmployees('user-1', 's1', ['e1']),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('setEmployees z pustą listą czyści przypisania bez sprawdzania pracowników', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    update.mockResolvedValue({ id: 's1', employees: [] });

    await service.setEmployees('user-1', 's1', []);

    expect(employeeCount).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toEqual({ employees: { set: [] } });
  });
});
