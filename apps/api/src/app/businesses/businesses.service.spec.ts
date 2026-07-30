import { Prisma, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { SearchBusinessesQueryDto } from './dto/search-businesses-query.dto';

const dto: CreateBusinessDto = {
  name: 'Salon Piękności Łucja',
  categoryId: 'cat-1',
  street: 'Kwiatowa 1',
  city: 'Warszawa',
  lat: 52.23,
  lng: 21.01,
};

const prismaError = (code: string, target?: string[]) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
    meta: target ? { target } : undefined,
  });

describe('BusinessesService', () => {
  let tx: {
    business: { create: ReturnType<typeof vi.fn> };
    user: { update: ReturnType<typeof vi.fn> };
  };
  let findFirst: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let service: BusinessesService;

  beforeEach(() => {
    tx = {
      business: { create: vi.fn().mockResolvedValue({ id: 'b1' }) },
      user: { update: vi.fn() },
    };
    findFirst = vi.fn();
    findUnique = vi.fn();
    update = vi.fn();
    findMany = vi.fn().mockResolvedValue([]);
    count = vi.fn().mockResolvedValue(0);
    queryRaw = vi.fn();
    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      $queryRaw: queryRaw,
      business: { findFirst, findUnique, update, findMany, count },
    };
    service = new BusinessesService(prisma as unknown as PrismaService);
  });

  it('findBySlug zwraca profil i pyta tylko o niezablokowaną firmę bez pól wrażliwych', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'salon' });

    const result = await service.findBySlug('salon');

    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: 'salon', isBlocked: false });
    expect(arg.select.ownerId).toBeUndefined();
    expect(arg.select.isBlocked).toBeUndefined();
    // publiczny profil pokazuje tylko aktywne usługi i pracowników (AC #11)
    expect(arg.select.services.where).toEqual({ isActive: true });
    expect(arg.select.services.select.employees.where).toEqual({
      isActive: true,
    });
    expect(arg.select.employees.where).toEqual({ isActive: true });
    expect(result).toEqual({ id: 'b1', slug: 'salon' });
  });

  it('findBySlug → 404 gdy brak firmy (nieistniejąca lub zablokowana)', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.findBySlug('nie-ma')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('findMine zwraca własną firmę po ownerId bez pól wrażliwych', async () => {
    findUnique.mockResolvedValue({ id: 'b1', slug: 'salon' });

    const result = await service.findMine('user-1');

    const arg = findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ ownerId: 'user-1' });
    expect(arg.select.ownerId).toBeUndefined();
    expect(arg.select.isBlocked).toBeUndefined();
    // cancellationHours potrzebne do prefillu formularza ustawień (AC #14)
    expect(arg.select.cancellationHours).toBe(true);
    expect(result).toEqual({ id: 'b1', slug: 'salon' });
  });

  it('findMine → 404 gdy OWNER nie ma jeszcze firmy', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.findMine('user-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('tworzy firmę ze slugiem bez polskich znaków i awansuje usera na OWNER', async () => {
    const result = await service.create('user-1', dto);

    const arg = tx.business.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      slug: 'salon-pieknosci-lucja',
      ownerId: 'user-1',
      name: dto.name,
    });
    expect(arg.select.ownerId).toBeUndefined();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: UserRole.OWNER },
    });
    expect(result).toEqual({ id: 'b1' });
  });

  it('druga firma tego samego usera → 409', async () => {
    tx.business.create.mockRejectedValue(prismaError('P2002', ['ownerId']));

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('kolizja sluga → ponowna próba z sufiksem', async () => {
    tx.business.create
      .mockRejectedValueOnce(prismaError('P2002', ['slug']))
      .mockResolvedValueOnce({ id: 'b2' });

    const result = await service.create('user-1', dto);

    expect(tx.business.create.mock.calls[1][0].data.slug).toMatch(
      /^salon-pieknosci-lucja-[0-9a-f]{4}$/,
    );
    expect(result).toEqual({ id: 'b2' });
  });

  it('nieistniejąca kategoria (P2003) → 400', async () => {
    tx.business.create.mockRejectedValue(prismaError('P2003'));

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('updateMine edytuje firmę po ownerId i nie zwraca pól wrażliwych', async () => {
    update.mockResolvedValue({ id: 'b1' });

    const result = await service.updateMine('user-1', { cancellationHours: 48 });

    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ ownerId: 'user-1' });
    expect(arg.data).toEqual({ cancellationHours: 48 });
    expect(arg.select.ownerId).toBeUndefined();
    expect(arg.select.isBlocked).toBeUndefined();
    expect(result).toEqual({ id: 'b1' });
  });

  it('updateMine → 404 gdy OWNER nie ma firmy (P2025)', async () => {
    update.mockRejectedValue(prismaError('P2025'));

    await expect(service.updateMine('user-1', {})).rejects.toMatchObject({
      status: 404,
    });
  });

  describe('search', () => {
    it('bez filtrów i bez geo: isBlocked wykluczone, sortowanie alfabetyczne, domyślna paginacja', async () => {
      await service.search({});

      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: { isBlocked: false },
        orderBy: { name: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(count.mock.calls[0][0]).toEqual({ where: { isBlocked: false } });
    });

    it('łączy category/city/q w jeden where (AND); city case-insensitive', async () => {
      const query: SearchBusinessesQueryDto = { category: 'fryzjer', city: 'Warszawa', q: 'strzyżenie' };

      await service.search(query);

      const where = findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        isBlocked: false,
        category: { slug: 'fryzjer' },
        city: { equals: 'Warszawa', mode: 'insensitive' },
        OR: [
          { name: { contains: 'strzyżenie', mode: 'insensitive' } },
          {
            services: {
              some: { isActive: true, name: { contains: 'strzyżenie', mode: 'insensitive' } },
            },
          },
        ],
      });
    });

    it('własna paginacja: page/limit przeliczają się na skip/take', async () => {
      await service.search({ page: '3', limit: '5' });

      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 5 });
    });

    it('zwraca total z count i przekazane page/limit', async () => {
      findMany.mockResolvedValue([{ id: 'b1' }]);
      count.mockResolvedValue(42);

      const result = await service.search({ page: '2', limit: '10' });

      expect(result).toEqual({ items: [{ id: 'b1' }], total: 42, page: 2, limit: 10 });
    });

    it('tylko lat bez lng → 400', async () => {
      await expect(service.search({ lat: '52.23' })).rejects.toMatchObject({ status: 400 });
      expect(findMany).not.toHaveBeenCalled();
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('tylko lng bez lat → 400', async () => {
      await expect(service.search({ lng: '21.01' })).rejects.toMatchObject({ status: 400 });
    });

    it('lat poza zakresem -90..90 → 400', async () => {
      await expect(service.search({ lat: '120', lng: '21.01' })).rejects.toMatchObject({ status: 400 });
    });

    it('page poza dozwolonym zakresem (nawet po przepełnieniu Number() do Infinity) → 400', async () => {
      await expect(service.search({ page: '9'.repeat(400) })).rejects.toMatchObject({ status: 400 });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('radiusKm poza dozwolonym zakresem → 400', async () => {
      await expect(
        service.search({ lat: '52.23', lng: '21.01', radiusKm: '1000' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('z lat/lng: woła $queryRaw (nie findMany), domyślny radiusKm i mapuje distanceKm', async () => {
      queryRaw
        .mockResolvedValueOnce([
          {
            id: 'b1',
            slug: 'salon',
            name: 'Salon',
            city: 'Warszawa',
            street: 'Kwiatowa 1',
            lat: 52.2297,
            lng: 21.0122,
            categoryId: 'cat-1',
            categoryName: 'Fryzjer',
            categorySlug: 'fryzjer',
            distanceKm: 3.14159,
          },
        ])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.search({ lat: '52.23', lng: '21.01' });

      expect(findMany).not.toHaveBeenCalled();
      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        items: [
          {
            id: 'b1',
            slug: 'salon',
            name: 'Salon',
            city: 'Warszawa',
            street: 'Kwiatowa 1',
            lat: 52.2297,
            lng: 21.0122,
            category: { id: 'cat-1', name: 'Fryzjer', slug: 'fryzjer' },
            distanceKm: 3.1,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });
  });
});
