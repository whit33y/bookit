import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const BUSINESS_ID = 'b1';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
  });

describe('AdminService', () => {
  let businessFindMany: ReturnType<typeof vi.fn>;
  let businessCount: ReturnType<typeof vi.fn>;
  let businessUpdate: ReturnType<typeof vi.fn>;
  let userFindMany: ReturnType<typeof vi.fn>;
  let userCount: ReturnType<typeof vi.fn>;
  let service: AdminService;

  beforeEach(() => {
    businessFindMany = vi.fn().mockResolvedValue([]);
    businessCount = vi.fn().mockResolvedValue(0);
    // mock odwzorowuje `updatedAt @updatedAt` ze schematu — kolumna zmienia się przy każdym
    // zapisie, więc test idempotencji nie może zakładać identycznych odpowiedzi co do bajta
    let writes = 0;
    businessUpdate = vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: BUSINESS_ID,
        slug: 'salon',
        updatedAt: new Date(2026, 0, 1, 0, ++writes),
        ...data,
      }),
    );
    userFindMany = vi.fn().mockResolvedValue([]);
    userCount = vi.fn().mockResolvedValue(0);
    const prisma = {
      business: {
        findMany: businessFindMany,
        count: businessCount,
        update: businessUpdate,
      },
      user: { findMany: userFindMany, count: userCount },
    };
    service = new AdminService(prisma as unknown as PrismaService);
  });

  describe('listBusinesses', () => {
    it('bez filtrów nie zawęża po isBlocked — admin widzi też zablokowane firmy', async () => {
      await service.listBusinesses({});

      const arg = businessFindMany.mock.calls[0][0];
      expect(arg.where).toEqual({});
      // id jako tiebreaker — seed wstawia paczkę firm z tym samym createdAt, a bez niego
      // ta sama firma potrafiłaby wyjść na dwóch sąsiednich stronach
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      // ten sam where trafia do count, inaczej total nie zgadzałby się z listą
      expect(businessCount.mock.calls[0][0].where).toEqual(arg.where);
    });

    it('blocked=true zawęża do zablokowanych, blocked=false do aktywnych', async () => {
      await service.listBusinesses({ blocked: 'true' });
      expect(businessFindMany.mock.calls[0][0].where).toEqual({ isBlocked: true });

      await service.listBusinesses({ blocked: 'false' });
      expect(businessFindMany.mock.calls[1][0].where).toEqual({ isBlocked: false });
    });

    it('fraza szuka po nazwie, mieście i emailu właściciela (bez rozróżniania wielkości liter)', async () => {
      await service.listBusinesses({ q: 'Salon' });

      expect(businessFindMany.mock.calls[0][0].where.OR).toEqual([
        { name: { contains: 'Salon', mode: 'insensitive' } },
        { city: { contains: 'Salon', mode: 'insensitive' } },
        { owner: { email: { contains: 'Salon', mode: 'insensitive' } } },
      ]);
    });

    it('łączy filtry i paginację, zwraca total z count', async () => {
      businessFindMany.mockResolvedValue([{ id: 'b1' }]);
      businessCount.mockResolvedValue(42);

      const result = await service.listBusinesses({ q: 'salon', blocked: 'true', page: '3', limit: '5' });

      const arg = businessFindMany.mock.calls[0][0];
      expect(arg.where.isBlocked).toBe(true);
      expect(arg.where.OR).toHaveLength(3);
      expect(arg.skip).toBe(10);
      expect(arg.take).toBe(5);
      expect(result).toEqual({ items: [{ id: 'b1' }], total: 42, page: 3, limit: 5 });
    });

    it('select zawiera dane do moderacji: właściciela, status i daty', async () => {
      await service.listBusinesses({});

      const { select } = businessFindMany.mock.calls[0][0];
      expect(select.owner.select.email).toBe(true);
      expect(select.isBlocked).toBe(true);
      expect(select.createdAt).toBe(true);
    });

    it('page/limit poza zakresem → 400', async () => {
      await expect(service.listBusinesses({ page: '0' })).rejects.toMatchObject({ status: 400 });
      await expect(service.listBusinesses({ limit: '101' })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('listUsers', () => {
    it('nigdy nie pyta o passwordHash', async () => {
      await service.listUsers({});

      const { select } = userFindMany.mock.calls[0][0];
      expect(select.passwordHash).toBeUndefined();
      expect(select.email).toBe(true);
      // firma właściciela — admin od razu widzi, kogo moderuje
      expect(select.business.select.isBlocked).toBe(true);
    });

    it('fraza szuka po emailu, imieniu i nazwisku', async () => {
      await service.listUsers({ q: 'kowal' });

      expect(userFindMany.mock.calls[0][0].where.OR).toEqual([
        { email: { contains: 'kowal', mode: 'insensitive' } },
        { firstName: { contains: 'kowal', mode: 'insensitive' } },
        { lastName: { contains: 'kowal', mode: 'insensitive' } },
      ]);
    });

    it('blocked=false zawęża do niezablokowanych, brak parametru nie filtruje', async () => {
      await service.listUsers({ blocked: 'false' });
      expect(userFindMany.mock.calls[0][0].where).toEqual({ isBlocked: false });

      await service.listUsers({});
      expect(userFindMany.mock.calls[1][0].where).toEqual({});
    });

    it('domyślnie pierwsza strona po 20 pozycji, najnowsi użytkownicy pierwsi', async () => {
      userFindMany.mockResolvedValue([{ id: 'u1' }]);
      userCount.mockResolvedValue(1);

      const result = await service.listUsers({});

      const arg = userFindMany.mock.calls[0][0];
      expect(arg).toMatchObject({
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      expect(result).toEqual({ items: [{ id: 'u1' }], total: 1, page: 1, limit: 20 });
    });

    it('page poza zakresem → 400', async () => {
      await expect(service.listUsers({ page: '9'.repeat(400) })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('block/unblock', () => {
    it('block ustawia isBlocked na true, unblock na false', async () => {
      await service.block(BUSINESS_ID);
      expect(businessUpdate.mock.calls[0][0]).toMatchObject({
        where: { id: BUSINESS_ID },
        data: { isBlocked: true },
      });

      await service.unblock(BUSINESS_ID);
      expect(businessUpdate.mock.calls[1][0]).toMatchObject({
        where: { id: BUSINESS_ID },
        data: { isBlocked: false },
      });
    });

    it('operacja jest idempotentna — powtórzony block zostawia ten sam stan', async () => {
      const first = await service.block(BUSINESS_ID);
      const second = await service.block(BUSINESS_ID);

      // zapis wartości docelowej, nie toggle: drugie wywołanie nie odblokowuje firmy
      expect(businessUpdate.mock.calls[1][0]).toEqual(businessUpdate.mock.calls[0][0]);
      expect(second.isBlocked).toBe(first.isBlocked);
      expect(second.isBlocked).toBe(true);
      // celowo nie porównujemy całych odpowiedzi: `updatedAt` bumpuje przy każdym zapisie,
      // więc idempotentny jest stan firmy, nie bajt w bajt identyczna odpowiedź
    });

    it('nieistniejąca firma (P2025) → 404', async () => {
      businessUpdate.mockRejectedValue(prismaError('P2025'));

      await expect(service.block(BUSINESS_ID)).rejects.toMatchObject({ status: 404 });
      await expect(service.unblock(BUSINESS_ID)).rejects.toMatchObject({ status: 404 });
    });

    it('inny błąd bazy leci dalej — nie udajemy 404', async () => {
      businessUpdate.mockRejectedValue(prismaError('P1001'));

      await expect(service.block(BUSINESS_ID)).rejects.toMatchObject({ code: 'P1001' });
    });

    it('zwraca wiersz w kształcie listy admina — panel podmienia go bez przeładowania', async () => {
      await service.block(BUSINESS_ID);
      await service.listBusinesses({});

      const { select } = businessUpdate.mock.calls[0][0];
      // dokładnie ten sam select co lista → front może wstawić odpowiedź w miejsce wiersza
      expect(select).toEqual(businessFindMany.mock.calls[0][0].select);
      expect(select.isBlocked).toBe(true);
      expect(select.owner.select.email).toBe(true);
    });
  });
});
