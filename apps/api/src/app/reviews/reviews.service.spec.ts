import { BookingStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

const prismaError = (code: string, target?: string[]) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
    meta: target ? { target } : undefined,
  });

// odbyta wizyta klienta user-1 — punkt wyjścia dla happy pathu
const completedBooking = {
  clientId: 'user-1',
  businessId: 'b1',
  status: BookingStatus.COMPLETED,
};

describe('ReviewsService', () => {
  let bookingFindUnique: ReturnType<typeof vi.fn>;
  let businessFindFirst: ReturnType<typeof vi.fn>;
  let reviewCreate: ReturnType<typeof vi.fn>;
  let reviewFindMany: ReturnType<typeof vi.fn>;
  let reviewGroupBy: ReturnType<typeof vi.fn>;
  let service: ReviewsService;

  beforeEach(() => {
    bookingFindUnique = vi.fn().mockResolvedValue(completedBooking);
    businessFindFirst = vi.fn().mockResolvedValue({ id: 'b1' });
    reviewCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }));
    reviewFindMany = vi.fn().mockResolvedValue([]);
    reviewGroupBy = vi.fn().mockResolvedValue([]);
    const prisma = {
      booking: { findUnique: bookingFindUnique },
      business: { findFirst: businessFindFirst },
      review: {
        create: reviewCreate,
        findMany: reviewFindMany,
        groupBy: reviewGroupBy,
      },
    };
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('odbyta własna wizyta → zapisuje recenzję z clientId z tokena i businessId z rezerwacji', async () => {
      const result = await service.create('user-1', 'bk-1', { rating: 5, comment: 'Polecam' });

      expect(reviewCreate.mock.calls[0][0].data).toEqual({
        bookingId: 'bk-1',
        clientId: 'user-1',
        businessId: 'b1',
        rating: 5,
        comment: 'Polecam',
      });
      expect(result).toMatchObject({ id: 'r1', rating: 5 });
    });

    it('brak komentarza → zapisuje null', async () => {
      await service.create('user-1', 'bk-1', { rating: 4 });

      expect(reviewCreate.mock.calls[0][0].data.comment).toBeNull();
    });

    it('nieistniejąca rezerwacja → 404, bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue(null);

      await expect(service.create('user-1', 'bk-1', { rating: 5 })).rejects.toMatchObject({
        status: 404,
      });
      expect(reviewCreate).not.toHaveBeenCalled();
    });

    it('cudza rezerwacja → 403 (nie 404), bez zapisu', async () => {
      bookingFindUnique.mockResolvedValue({ ...completedBooking, clientId: 'ktos-inny' });

      await expect(service.create('user-1', 'bk-1', { rating: 5 })).rejects.toMatchObject({
        status: 403,
      });
      expect(reviewCreate).not.toHaveBeenCalled();
    });

    it.each([
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.DECLINED,
      BookingStatus.CANCELLED_BY_CLIENT,
      BookingStatus.CANCELLED_BY_BUSINESS,
    ])('status %s → 409, bez zapisu', async (status) => {
      bookingFindUnique.mockResolvedValue({ ...completedBooking, status });

      await expect(service.create('user-1', 'bk-1', { rating: 5 })).rejects.toMatchObject({
        status: 409,
      });
      expect(reviewCreate).not.toHaveBeenCalled();
    });

    it('druga recenzja tej samej wizyty (P2002 na bookingId) → 409', async () => {
      reviewCreate.mockRejectedValue(prismaError('P2002', ['bookingId']));

      await expect(service.create('user-1', 'bk-1', { rating: 5 })).rejects.toMatchObject({
        status: 409,
      });
    });

    it('inny błąd Prismy leci dalej (nie udaje 409)', async () => {
      reviewCreate.mockRejectedValue(prismaError('P2003'));

      await expect(service.create('user-1', 'bk-1', { rating: 5 })).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('nie zwraca clientId wystawiającego', async () => {
      await service.create('user-1', 'bk-1', { rating: 5 });

      expect(reviewCreate.mock.calls[0][0].select.clientId).toBeUndefined();
    });
  });

  describe('listForBusiness', () => {
    const row = {
      id: 'r1',
      rating: 5,
      comment: 'Polecam',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      client: { firstName: 'Anna', lastName: 'Kowalska' },
    };

    // wiersze tak, jak zwraca je groupBy({ by: ['rating'] })
    const byRating = (counts: Record<number, number>) =>
      Object.entries(counts).map(([rating, count]) => ({
        rating: Number(rating),
        _count: { _all: count },
      }));

    it('maskuje autora do imienia z inicjałem i nie zwraca danych klienta', async () => {
      reviewFindMany.mockResolvedValue([row]);
      reviewGroupBy.mockResolvedValue(byRating({ 5: 1 }));

      const result = await service.listForBusiness('salon', {});

      expect(result.items).toEqual([
        {
          id: 'r1',
          rating: 5,
          comment: 'Polecam',
          createdAt: row.createdAt,
          author: 'Anna K.',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('Kowalska');
    });

    it('pyta tylko o niezablokowaną firmę i filtruje recenzje po jej id', async () => {
      await service.listForBusiness('salon', {});

      expect(businessFindFirst.mock.calls[0][0].where).toEqual({
        slug: 'salon',
        isBlocked: false,
      });
      expect(reviewFindMany.mock.calls[0][0].where).toEqual({ businessId: 'b1' });
      expect(reviewGroupBy.mock.calls[0][0].where).toEqual({ businessId: 'b1' });
    });

    it('sortuje od najnowszych, z id jako tiebreakerem', async () => {
      await service.listForBusiness('salon', {});

      expect(reviewFindMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('domyślna paginacja → skip 0, take 20', async () => {
      await service.listForBusiness('salon', {});

      expect(reviewFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
    });

    it('page/limit przeliczają się na skip/take i wracają w odpowiedzi', async () => {
      reviewGroupBy.mockResolvedValue(byRating({ 1: 0, 2: 1, 3: 4, 4: 12, 5: 25 }));

      const result = await service.listForBusiness('salon', { page: '3', limit: '5' });

      expect(reviewFindMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 5 });
      expect(result).toMatchObject({ total: 42, page: 3, limit: 5 });
    });

    it('rozkład ocen liczy groupBy po rating, tym samym where co lista i bez skip/take', async () => {
      await service.listForBusiness('salon', { page: '2', limit: '5' });

      const arg = reviewGroupBy.mock.calls[0][0];
      expect(arg).toMatchObject({ by: ['rating'], _count: { _all: true } });
      expect(arg.where).toEqual({ businessId: 'b1' });
      expect(arg.skip).toBeUndefined();
      expect(arg.take).toBeUndefined();
    });

    it('rozkład zwraca wszystkie stopnie, z zerami dla ocen bez recenzji', async () => {
      reviewGroupBy.mockResolvedValue(byRating({ 3: 4, 5: 25 }));

      const result = await service.listForBusiness('salon', {});

      expect(result.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 4, 4: 0, 5: 25 });
    });

    // sedno #111: histogram opisuje całą firmę, więc nie może zależeć od tego, którą stronę
    // recenzji akurat czytamy
    it('rozkład ten sam niezależnie od numeru strony', async () => {
      reviewGroupBy.mockResolvedValue(byRating({ 4: 2, 5: 7 }));

      const first = await service.listForBusiness('salon', { page: '1', limit: '1' });
      const third = await service.listForBusiness('salon', { page: '3', limit: '1' });

      expect(third.ratingDistribution).toEqual(first.ratingDistribution);
      expect(third.total).toBe(first.total);
    });

    it('firma bez recenzji → zera na każdym stopniu i total 0', async () => {
      reviewGroupBy.mockResolvedValue([]);

      const result = await service.listForBusiness('nowa', {});

      expect(result.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
      expect(result.total).toBe(0);
    });

    it('total bierze się z sumy rozkładu, bez osobnego zapytania zliczającego', async () => {
      reviewGroupBy.mockResolvedValue(byRating({ 1: 0, 2: 1, 3: 4, 4: 12, 5: 25 }));

      const result = await service.listForBusiness('salon', {});

      expect(result.total).toBe(42);
      expect(reviewGroupBy).toHaveBeenCalledTimes(1);
    });

    // paginację walidujemy przed zapytaniem o firmę, więc zły limit daje 400 także dla
    // nieistniejącego sluga — i nie kosztuje ani jednego zapytania do bazy
    it('limit poza zakresem → 400, bez żadnego zapytania do bazy', async () => {
      await expect(service.listForBusiness('salon', { limit: '500' })).rejects.toMatchObject({
        status: 400,
      });
      expect(businessFindFirst).not.toHaveBeenCalled();
      expect(reviewFindMany).not.toHaveBeenCalled();
    });

    it('zły limit wygrywa z nieistniejącą firmą → 400, nie 404', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(service.listForBusiness('nie-ma', { limit: '500' })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('nieistniejąca lub zablokowana firma → 404, bez odpytywania recenzji', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(service.listForBusiness('nie-ma', {})).rejects.toMatchObject({ status: 404 });
      expect(reviewFindMany).not.toHaveBeenCalled();
    });
  });

  describe('statsFor', () => {
    it('pusta lista id → pusta mapa, bez zapytania do bazy', async () => {
      const result = await service.statsFor([]);

      expect(result.size).toBe(0);
      expect(reviewGroupBy).not.toHaveBeenCalled();
    });

    it('jedno groupBy na wszystkie firmy, ze średnią zaokrągloną', async () => {
      reviewGroupBy.mockResolvedValue([
        { businessId: 'b1', _avg: { rating: 4.666666666666667 }, _count: { _all: 3 } },
      ]);

      const result = await service.statsFor(['b1', 'b2']);

      expect(reviewGroupBy).toHaveBeenCalledTimes(1);
      expect(reviewGroupBy.mock.calls[0][0].where).toEqual({
        businessId: { in: ['b1', 'b2'] },
      });
      expect(result.get('b1')).toEqual({ avgRating: 4.7, reviewCount: 3 });
    });

    // AC #111: rozkład zostaje w liście recenzji i nie wchodzi na karty wyszukiwarki (#34),
    // które biorą kształt właśnie stąd
    it('nie dokłada rozkładu ocen — tylko avgRating i reviewCount', async () => {
      reviewGroupBy.mockResolvedValue([
        { businessId: 'b1', _avg: { rating: 4 }, _count: { _all: 2 } },
      ]);

      const result = await service.statsFor(['b1']);

      expect(Object.keys(result.get('b1') ?? {})).toEqual(['avgRating', 'reviewCount']);
    });

    it('firma bez recenzji nie trafia do mapy (wołający podstawia EMPTY_REVIEW_STATS)', async () => {
      reviewGroupBy.mockResolvedValue([]);

      const result = await service.statsFor(['b1']);

      expect(result.has('b1')).toBe(false);
    });
  });
});
