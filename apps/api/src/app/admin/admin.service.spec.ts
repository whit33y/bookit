import { BusinessStatus, Prisma, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';
import { BusinessApplicationEventsService } from './business-application-events.service';

const BUSINESS_ID = 'b1';
const OWNER_ID = 'u1';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('błąd', {
    code,
    clientVersion: 'test',
  });

describe('AdminService', () => {
  let businessFindMany: ReturnType<typeof vi.fn>;
  let businessCount: ReturnType<typeof vi.fn>;
  let businessUpdate: ReturnType<typeof vi.fn>;
  let businessUpdateMany: ReturnType<typeof vi.fn>;
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let businessFindUniqueOrThrow: ReturnType<typeof vi.fn>;
  let userFindMany: ReturnType<typeof vi.fn>;
  let userCount: ReturnType<typeof vi.fn>;
  let userUpdateMany: ReturnType<typeof vi.fn>;
  let events: { approved: ReturnType<typeof vi.fn>; rejected: ReturnType<typeof vi.fn> };
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
    // decyzja o zgłoszeniu: warunkowy updateMany + odczyt wiersza do odpowiedzi
    businessUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    businessFindUnique = vi
      .fn()
      .mockResolvedValue({ status: BusinessStatus.PENDING });
    businessFindUniqueOrThrow = vi.fn().mockImplementation(() =>
      Promise.resolve({
        id: BUSINESS_ID,
        slug: 'salon',
        status: BusinessStatus.PENDING,
        rejectionReason: null,
        owner: { id: OWNER_ID, email: 'ola@example.com' },
      }),
    );
    userFindMany = vi.fn().mockResolvedValue([]);
    userCount = vi.fn().mockResolvedValue(0);
    userUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      business: {
        findMany: businessFindMany,
        count: businessCount,
        update: businessUpdate,
        updateMany: businessUpdateMany,
        findUnique: businessFindUnique,
        findUniqueOrThrow: businessFindUniqueOrThrow,
      },
      user: { findMany: userFindMany, count: userCount, updateMany: userUpdateMany },
      // transakcja bez bazy: callback dostaje ten sam klient, więc test sprawdza kolejność
      // i argumenty zapisów, a atomowość zostaje po stronie Prismy
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    events = { approved: vi.fn(), rejected: vi.fn() };
    service = new AdminService(
      prisma as unknown as PrismaService,
      events as unknown as BusinessApplicationEventsService,
    );
  });

  describe('listBusinesses', () => {
    it('bez filtrów nie zawęża po isBlocked — admin widzi też zablokowane firmy', async () => {
      await service.listBusinesses({});

      const arg = businessFindMany.mock.calls[0][0];
      // status jest jedynym filtrem domyślnym: rejestr pokazuje firmy wpuszczone,
      // zgłoszenia mają własną kolejkę
      expect(arg.where).toEqual({ status: BusinessStatus.APPROVED });
      // id jako tiebreaker — seed wstawia paczkę firm z tym samym createdAt, a bez niego
      // ta sama firma potrafiłaby wyjść na dwóch sąsiednich stronach
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      // ten sam where trafia do count, inaczej total nie zgadzałby się z listą
      expect(businessCount.mock.calls[0][0].where).toEqual(arg.where);
    });

    it('blocked=true zawęża do zablokowanych, blocked=false do aktywnych', async () => {
      await service.listBusinesses({ blocked: 'true' });
      expect(businessFindMany.mock.calls[0][0].where).toEqual({
        status: BusinessStatus.APPROVED,
        isBlocked: true,
      });

      await service.listBusinesses({ blocked: 'false' });
      expect(businessFindMany.mock.calls[1][0].where).toEqual({
        status: BusinessStatus.APPROVED,
        isBlocked: false,
      });
    });

    it('domyślnie tylko APPROVED, a ?status= pozwala zajrzeć do pozostałych stanów', async () => {
      await service.listBusinesses({});
      expect(businessFindMany.mock.calls[0][0].where.status).toBe(BusinessStatus.APPROVED);

      await service.listBusinesses({ status: BusinessStatus.REJECTED });
      expect(businessFindMany.mock.calls[1][0].where.status).toBe(BusinessStatus.REJECTED);

      // ten sam where trafia do count, inaczej total kłamałby przy filtrze
      expect(businessCount.mock.calls[1][0].where.status).toBe(BusinessStatus.REJECTED);
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

  describe('listApplications', () => {
    it('pokazuje wyłącznie PENDING i najstarsze pierwsze — to kolejka, nie rejestr', async () => {
      businessFindMany.mockResolvedValue([{ id: BUSINESS_ID }]);
      businessCount.mockResolvedValue(1);

      const result = await service.listApplications({});

      const arg = businessFindMany.mock.calls[0][0];
      expect(arg.where).toEqual({ status: BusinessStatus.PENDING });
      // odwrotnie niż w rejestrze: w kolejce liczy się to, co czeka najdłużej
      expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
      expect(businessCount.mock.calls[0][0].where).toEqual(arg.where);
      expect(result).toEqual({ items: [{ id: BUSINESS_ID }], total: 1, page: 1, limit: 20 });
    });

    it('niesie stan sprawy i szuka po nazwie, mieście oraz emailu zgłaszającego', async () => {
      await service.listApplications({ q: 'salon' });

      const arg = businessFindMany.mock.calls[0][0];
      expect(arg.select.status).toBe(true);
      expect(arg.select.rejectionReason).toBe(true);
      expect(arg.where.OR).toEqual([
        { name: { contains: 'salon', mode: 'insensitive' } },
        { city: { contains: 'salon', mode: 'insensitive' } },
        { owner: { email: { contains: 'salon', mode: 'insensitive' } } },
      ]);
      // filtr statusu zostaje mimo frazy — inaczej wyszukiwanie wypuszczałoby rozpatrzone
      expect(arg.where.status).toBe(BusinessStatus.PENDING);
    });

    it('page/limit poza zakresem → 400', async () => {
      await expect(service.listApplications({ limit: '101' })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('approve/reject', () => {
    it('approve ustawia APPROVED i awansuje właściciela na OWNER w jednej transakcji', async () => {
      await service.approve(BUSINESS_ID);

      expect(businessUpdateMany.mock.calls[0][0]).toEqual({
        // warunek na PENDING jest częścią zapisu — dwóch adminów naraz nie nadpisze
        // cudzej decyzji
        where: { id: BUSINESS_ID, status: BusinessStatus.PENDING },
        data: { status: BusinessStatus.APPROVED },
      });
      // warunek na CLIENT jest częścią zapisu: awans podnosi zgłaszającego, nigdy nie
      // nadpisuje w dół roli, którą konto już ma (np. ADMIN-a z własnym zgłoszeniem)
      expect(userUpdateMany.mock.calls[0][0]).toEqual({
        where: { id: OWNER_ID, role: UserRole.CLIENT },
        data: { role: UserRole.OWNER },
      });
    });

    it('reject zapisuje powód i nie rusza roli użytkownika', async () => {
      await service.reject(BUSINESS_ID, { reason: '  Brak numeru NIP  ' });

      expect(businessUpdateMany.mock.calls[0][0]).toEqual({
        where: { id: BUSINESS_ID, status: BusinessStatus.PENDING },
        // powód przycięty: trafia do maila i na formularz zgłaszającego
        data: { status: BusinessStatus.REJECTED, rejectionReason: 'Brak numeru NIP' },
      });
      expect(userUpdateMany).not.toHaveBeenCalled();
    });

    it('powtórzona decyzja → 409 i żadnego zapisu', async () => {
      businessUpdateMany.mockResolvedValue({ count: 0 });
      businessFindUnique.mockResolvedValue({ status: BusinessStatus.APPROVED });

      await expect(service.approve(BUSINESS_ID)).rejects.toMatchObject({ status: 409 });
      await expect(
        service.reject(BUSINESS_ID, { reason: 'za późno' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(userUpdateMany).not.toHaveBeenCalled();
    });

    it('nieistniejące zgłoszenie → 404', async () => {
      businessUpdateMany.mockResolvedValue({ count: 0 });
      businessFindUnique.mockResolvedValue(null);

      await expect(service.approve(BUSINESS_ID)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.reject(BUSINESS_ID, { reason: 'nie ma czego odrzucać' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('powiadamia zgłaszającego dopiero po zapisanej decyzji, osobno dla każdej', async () => {
      await service.approve(BUSINESS_ID);
      expect(events.approved).toHaveBeenCalledWith(BUSINESS_ID);
      expect(events.rejected).not.toHaveBeenCalled();

      await service.reject(BUSINESS_ID, { reason: 'brak danych' });
      expect(events.rejected).toHaveBeenCalledWith(BUSINESS_ID);
    });

    it('nieudana decyzja nie wysyła powiadomienia', async () => {
      businessUpdateMany.mockResolvedValue({ count: 0 });
      businessFindUnique.mockResolvedValue(null);

      await expect(service.approve(BUSINESS_ID)).rejects.toMatchObject({ status: 404 });

      expect(events.approved).not.toHaveBeenCalled();
    });

    it('zwraca wiersz kolejki ze stanem sprawy — panel podmienia go bez przeładowania', async () => {
      await service.approve(BUSINESS_ID);
      await service.listApplications({});

      const { select } = businessFindUniqueOrThrow.mock.calls[0][0];
      expect(select).toEqual(businessFindMany.mock.calls[0][0].select);
      expect(select.status).toBe(true);
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
