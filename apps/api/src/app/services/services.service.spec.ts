import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

const dto: CreateServiceDto = {
  name: 'Strzyżenie',
  durationMin: 30,
  priceCents: 5000,
};

describe('ServicesService', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
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
    const prisma = {
      business: { findUnique: businessFindUnique },
      service: { findMany, findFirst, findUnique, create, updateMany, update, delete: remove },
    };
    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('findAll zwraca wszystkie usługi firmy (także nieaktywne) scope po businessId', async () => {
    findMany.mockResolvedValue([{ id: 's1' }]);

    const result = await service.findAll('user-1');

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ businessId: 'b1' });
    // brak filtra isActive — widok właściciela pokazuje też dezaktywowane
    expect(arg.where.isActive).toBeUndefined();
    expect(result).toEqual([{ id: 's1' }]);
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
    expect(result).toEqual({ id: 's1', isActive: false });
  });

  it('remove bez rezerwacji → twarde usunięcie', async () => {
    findFirst.mockResolvedValue({ id: 's1', _count: { bookings: 0 } });
    remove.mockResolvedValue({ id: 's1' });

    const result = await service.remove('user-1', 's1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 's1' });
  });

  it('remove cudzej/nieistniejącej usługi → 404', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.remove('user-1', 's1')).rejects.toMatchObject({ status: 404 });
  });
});
