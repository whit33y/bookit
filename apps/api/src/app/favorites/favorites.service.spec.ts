import { NotFoundException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_REVIEW_STATS } from '../reviews/review-stats';
import { ReviewsService } from '../reviews/reviews.service';
import { FavoritesService } from './favorites.service';

const USER_ID = 'u1';
const BUSINESS_ID = 'b1';

const business = (overrides: Record<string, unknown> = {}) => ({
  id: BUSINESS_ID,
  slug: 'salon-ola',
  name: 'Salon Ola',
  city: 'Warszawa',
  street: 'ul. Kwiatowa 1',
  logoVersion: null,
  status: BusinessStatus.APPROVED,
  isBlocked: false,
  category: { id: 'c1', name: 'Fryzjer', slug: 'fryzjer' },
  ...overrides,
});

describe('FavoritesService', () => {
  let businessFindFirst: ReturnType<typeof vi.fn>;
  let favoriteCreateMany: ReturnType<typeof vi.fn>;
  let favoriteDeleteMany: ReturnType<typeof vi.fn>;
  let favoriteFindMany: ReturnType<typeof vi.fn>;
  let statsFor: ReturnType<typeof vi.fn>;
  let service: FavoritesService;

  beforeEach(() => {
    businessFindFirst = vi.fn().mockResolvedValue({ id: BUSINESS_ID });
    // odpowiedź Prismy przy trafieniu w @@unique([userId, businessId]) z skipDuplicates
    favoriteCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    favoriteDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    favoriteFindMany = vi.fn().mockResolvedValue([]);
    statsFor = vi.fn().mockResolvedValue(new Map());
    service = new FavoritesService(
      {
        business: { findFirst: businessFindFirst },
        favoriteBusiness: {
          createMany: favoriteCreateMany,
          deleteMany: favoriteDeleteMany,
          findMany: favoriteFindMany,
        },
      } as unknown as PrismaService,
      { statsFor } as unknown as ReviewsService,
    );
  });

  describe('add', () => {
    it('wstawia wiersz z skipDuplicates — drugi klik nie może dać konfliktu', async () => {
      await service.add(USER_ID, BUSINESS_ID);

      expect(favoriteCreateMany).toHaveBeenCalledTimes(1);
      expect(favoriteCreateMany.mock.calls[0][0]).toEqual({
        data: { userId: USER_ID, businessId: BUSINESS_ID },
        skipDuplicates: true,
      });
    });

    // idempotencja widziana od strony wywołania: powtórzony PUT z dwóch kart przechodzi
    // tą samą ścieżką i nie rzuca — liczbę wierszy pilnuje klucz unikalny w bazie
    it('powtórzone dodanie przechodzi bez wyjątku', async () => {
      favoriteCreateMany.mockResolvedValueOnce({ count: 1 });
      favoriteCreateMany.mockResolvedValueOnce({ count: 0 });

      await service.add(USER_ID, BUSINESS_ID);
      await expect(service.add(USER_ID, BUSINESS_ID)).resolves.toBeUndefined();
    });

    it('zawęża firmę warunkiem „firma działająca"', async () => {
      await service.add(USER_ID, BUSINESS_ID);

      expect(businessFindFirst.mock.calls[0][0].where).toEqual({
        id: BUSINESS_ID,
        isBlocked: false,
        status: BusinessStatus.APPROVED,
      });
    });

    it('firma zablokowana albo niezaakceptowana → 404 i żadnego zapisu', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(service.add(USER_ID, BUSINESS_ID)).rejects.toThrow(NotFoundException);
      expect(favoriteCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('kasuje przez deleteMany zawężone własnym userId', async () => {
      await service.remove(USER_ID, BUSINESS_ID);

      expect(favoriteDeleteMany.mock.calls[0][0]).toEqual({
        where: { userId: USER_ID, businessId: BUSINESS_ID },
      });
    });

    it('brak wiersza to stan docelowy, nie błąd', async () => {
      favoriteDeleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(USER_ID, BUSINESS_ID)).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('najnowsze pierwsze, bez paginacji', async () => {
      await service.list(USER_ID);

      const arg = favoriteFindMany.mock.calls[0][0];
      expect(arg.where).toEqual({ userId: USER_ID });
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBeUndefined();
      expect(arg.skip).toBeUndefined();
    });

    it('nie filtruje przez „firma działająca" — zablokowana zostaje z isAvailable: false', async () => {
      favoriteFindMany.mockResolvedValue([
        { business: business({ id: 'b1', isBlocked: true }) },
        { business: business({ id: 'b2' }) },
      ]);

      const items = await service.list(USER_ID);

      expect(items.map((item) => [item.id, item.isAvailable])).toEqual([
        ['b1', false],
        ['b2', true],
      ]);
    });

    it('firma czekająca na akceptację też jest niedostępna', async () => {
      favoriteFindMany.mockResolvedValue([
        { business: business({ status: BusinessStatus.PENDING }) },
      ]);

      const [item] = await service.list(USER_ID);

      expect(item.isAvailable).toBe(false);
    });

    it('status i isBlocked nie wychodzą w odpowiedzi — front nie składa ich sam', async () => {
      favoriteFindMany.mockResolvedValue([{ business: business() }]);

      const [item] = await service.list(USER_ID);

      expect(item).not.toHaveProperty('status');
      expect(item).not.toHaveProperty('isBlocked');
      expect(item).toMatchObject({
        slug: 'salon-ola',
        name: 'Salon Ola',
        city: 'Warszawa',
        logoVersion: null,
        category: { slug: 'fryzjer' },
      });
    });

    it('dokleja ocenę jednym zapytaniem na całą listę, a firma bez recenzji ma avgRating null', async () => {
      favoriteFindMany.mockResolvedValue([
        { business: business({ id: 'b1' }) },
        { business: business({ id: 'b2' }) },
      ]);
      statsFor.mockResolvedValue(new Map([['b1', { avgRating: 4.5, reviewCount: 2 }]]));

      const items = await service.list(USER_ID);

      expect(statsFor).toHaveBeenCalledTimes(1);
      expect(statsFor.mock.calls[0][0]).toEqual(['b1', 'b2']);
      expect(items[0]).toMatchObject({ avgRating: 4.5, reviewCount: 2 });
      expect(items[1]).toMatchObject(EMPTY_REVIEW_STATS);
    });
  });

  describe('listIds', () => {
    it('oddaje same identyfikatory, bez pytania o dane firm', async () => {
      favoriteFindMany.mockResolvedValue([{ businessId: 'b1' }, { businessId: 'b2' }]);

      expect(await service.listIds(USER_ID)).toEqual({ ids: ['b1', 'b2'] });
      expect(favoriteFindMany.mock.calls[0][0].select).toEqual({ businessId: true });
      expect(statsFor).not.toHaveBeenCalled();
    });

    // inaczej serce na profilu firmy zablokowanej byłoby puste, a na liście zapalone
    it('nie zawęża po „firma działająca"', async () => {
      await service.listIds(USER_ID);

      expect(favoriteFindMany.mock.calls[0][0].where).toEqual({ userId: USER_ID });
    });
  });
});
