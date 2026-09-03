import { BusinessStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from '../reviews/reviews.service';
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
  let findFirst: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let userUpdate: ReturnType<typeof vi.fn>;
  let statsFor: ReturnType<typeof vi.fn>;
  let service: BusinessesService;

  // firma bez recenzji — tyle dokleja się domyślnie do każdego wyniku (#47)
  const noStats = { avgRating: null, reviewCount: 0 };

  // publiczne ścieżki widzą wyłącznie firmę wpuszczoną i niezablokowaną (#141)
  const publicWhere = { isBlocked: false, status: BusinessStatus.APPROVED };

  beforeEach(() => {
    findFirst = vi.fn();
    // domyślnie zgłaszający nie ma jeszcze żadnego wiersza
    findUnique = vi.fn().mockResolvedValue(null);
    create = vi.fn().mockResolvedValue({ id: 'b1' });
    update = vi.fn();
    findMany = vi.fn().mockResolvedValue([]);
    count = vi.fn().mockResolvedValue(0);
    queryRaw = vi.fn();
    userUpdate = vi.fn();
    // domyślnie żadna firma nie ma recenzji — groupBy nie zwraca dla nich wierszy
    statsFor = vi.fn().mockResolvedValue(new Map());
    const prisma = {
      $queryRaw: queryRaw,
      business: { findFirst, findUnique, create, update, findMany, count },
      user: { update: userUpdate },
    };
    service = new BusinessesService(
      prisma as unknown as PrismaService,
      { statsFor } as unknown as ReviewsService,
    );
  });

  it('findBySlug zwraca profil i pyta tylko o niezablokowaną firmę bez pól wrażliwych', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'salon' });

    const result = await service.findBySlug('salon');

    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: 'salon', ...publicWhere });
    expect(arg.select.ownerId).toBeUndefined();
    expect(arg.select.isBlocked).toBeUndefined();
    // publiczny profil pokazuje tylko aktywne usługi i pracowników (AC #11)
    expect(arg.select.services.where).toEqual({ isActive: true });
    expect(arg.select.services.select.employees.where).toEqual({
      isActive: true,
    });
    expect(arg.select.employees.where).toEqual({ isActive: true });
    expect(result).toEqual({ id: 'b1', slug: 'salon', ...noStats });
  });

  it('findBySlug dokleja avgRating i reviewCount z agregatu recenzji', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'salon' });
    statsFor.mockResolvedValue(new Map([['b1', { avgRating: 4.7, reviewCount: 3 }]]));

    const result = await service.findBySlug('salon');

    expect(statsFor).toHaveBeenCalledWith(['b1']);
    expect(result).toEqual({ id: 'b1', slug: 'salon', avgRating: 4.7, reviewCount: 3 });
  });

  it('findBySlug firmy bez recenzji → avgRating null, nie atrapa 0.0', async () => {
    findFirst.mockResolvedValue({ id: 'b1', slug: 'salon' });

    const result = await service.findBySlug('salon');

    expect(result).toMatchObject({ avgRating: null, reviewCount: 0 });
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

  it('zapisuje zgłoszenie w PENDING ze slugiem bez polskich znaków i nie rusza roli usera', async () => {
    const result = await service.create('user-1', dto);

    const arg = create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      slug: 'salon-pieknosci-lucja',
      ownerId: 'user-1',
      name: dto.name,
      status: BusinessStatus.PENDING,
      rejectionReason: null,
    });
    // rola przychodzi dopiero z akceptacją administratora (#143) — zgłoszenie jej nie rusza
    expect(userUpdate).not.toHaveBeenCalled();
    expect(arg.select.ownerId).toBeUndefined();
    // zgłaszający ma zobaczyć stan swojej sprawy
    expect(arg.select.status).toBe(true);
    expect(arg.select.rejectionReason).toBe(true);
    expect(result).toEqual({ id: 'b1' });
  });

  it('ponowne zgłoszenie przy PENDING → 409, bez zapisu', async () => {
    findUnique.mockResolvedValue({ id: 'b1', status: BusinessStatus.PENDING });

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 409,
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('zgłoszenie przy działającej firmie (APPROVED) → 409', async () => {
    findUnique.mockResolvedValue({ id: 'b1', status: BusinessStatus.APPROVED });

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('ponowne zgłoszenie po odrzuceniu nadpisuje ten sam wiersz i czyści powód', async () => {
    findUnique.mockResolvedValue({ id: 'b1', status: BusinessStatus.REJECTED });
    update.mockResolvedValue({ id: 'b1', status: BusinessStatus.PENDING });

    const result = await service.create('user-1', dto);

    expect(create).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'b1' });
    expect(arg.data).toMatchObject({
      slug: 'salon-pieknosci-lucja',
      status: BusinessStatus.PENDING,
      rejectionReason: null,
      // nowe zgłoszenie w całości: pola pominięte w formularzu czyszczą poprzednie wartości
      description: null,
      phone: null,
      postalCode: null,
      cancellationHours: 24,
    });
    // ownerId zostaje ten sam — wiersz jest kluczowany po nim, nie zakładamy drugiego
    expect(arg.data.ownerId).toBeUndefined();
    expect(result).toEqual({ id: 'b1', status: BusinessStatus.PENDING });
  });

  it('wyścig dwóch zgłoszeń tego samego usera (P2002 ownerId) → 409', async () => {
    create.mockRejectedValue(prismaError('P2002', ['ownerId']));

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('kolizja sluga → ponowna próba z sufiksem', async () => {
    create
      .mockRejectedValueOnce(prismaError('P2002', ['slug']))
      .mockResolvedValueOnce({ id: 'b2' });

    const result = await service.create('user-1', dto);

    expect(create.mock.calls[1][0].data.slug).toMatch(
      /^salon-pieknosci-lucja-[0-9a-f]{4}$/,
    );
    expect(result).toEqual({ id: 'b2' });
  });

  it('nieistniejąca kategoria (P2003) → 400', async () => {
    create.mockRejectedValue(prismaError('P2003'));

    await expect(service.create('user-1', dto)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('findApplication zwraca stan zgłoszenia razem z powodem odrzucenia', async () => {
    findUnique.mockResolvedValue({
      id: 'b1',
      status: BusinessStatus.REJECTED,
      rejectionReason: 'Adres nie istnieje',
    });

    const result = await service.findApplication('user-1');

    const arg = findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ ownerId: 'user-1' });
    expect(arg.select.status).toBe(true);
    expect(arg.select.rejectionReason).toBe(true);
    expect(arg.select.ownerId).toBeUndefined();
    expect(result).toMatchObject({ status: BusinessStatus.REJECTED });
  });

  it('findApplication → 404, gdy user nic nie zgłaszał', async () => {
    await expect(service.findApplication('user-1')).rejects.toMatchObject({
      status: 404,
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
    it('bez filtrów i bez geo: niedziałające firmy wykluczone, sortowanie alfabetyczne, domyślna paginacja', async () => {
      await service.search({});

      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: publicWhere,
        orderBy: { name: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(count.mock.calls[0][0]).toEqual({ where: publicWhere });
    });

    it('łączy category/city/q w jeden where (AND); city case-insensitive', async () => {
      const query: SearchBusinessesQueryDto = { category: 'fryzjer', city: 'Warszawa', q: 'strzyżenie' };

      await service.search(query);

      const where = findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        ...publicWhere,
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

      expect(result).toEqual({
        items: [{ id: 'b1', ...noStats }],
        total: 42,
        page: 2,
        limit: 10,
      });
    });

    it('ścieżka alfabetyczna dokleja statystyki ocen do każdej karty wyniku', async () => {
      findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      count.mockResolvedValue(2);
      statsFor.mockResolvedValue(new Map([['b2', { avgRating: 3.5, reviewCount: 8 }]]));

      const result = await service.search({});

      // jedno zapytanie na całą stronę wyników, nie po jednym na firmę
      expect(statsFor).toHaveBeenCalledTimes(1);
      expect(statsFor).toHaveBeenCalledWith(['b1', 'b2']);
      expect(result.items).toEqual([
        { id: 'b1', ...noStats },
        { id: 'b2', avgRating: 3.5, reviewCount: 8 },
      ]);
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
            ...noStats,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('ścieżka geograficzna filtruje te same firmy co alfabetyczna (status i blokada w SQL)', async () => {
      queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

      await service.search({ lat: '52.23', lng: '21.01' });

      // warunki wchodzą do zapytania jako zagnieżdżony fragment Prisma.Sql (tekst + parametry)
      const fragments = queryRaw.mock.calls[0]
        .slice(1)
        .filter(
          (value: unknown): value is Prisma.Sql =>
            typeof value === 'object' && value !== null && 'sql' in value,
        );
      const sql = fragments.map((fragment) => fragment.sql).join(' ');
      expect(sql).toContain('"isBlocked" = false');
      expect(sql).toContain('"status"');
      expect(fragments.flatMap((fragment) => fragment.values)).toContain(
        BusinessStatus.APPROVED,
      );
    });

    it('ścieżka geograficzna też dokleja statystyki ocen (bez podselektu w SQL)', async () => {
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
      statsFor.mockResolvedValue(new Map([['b1', { avgRating: 5, reviewCount: 1 }]]));

      const result = await service.search({ lat: '52.23', lng: '21.01' });

      expect(statsFor).toHaveBeenCalledWith(['b1']);
      expect(result.items[0]).toMatchObject({ distanceKm: 3.1, avgRating: 5, reviewCount: 1 });
    });
  });
});
