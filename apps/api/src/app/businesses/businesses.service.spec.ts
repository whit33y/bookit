import { Prisma, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';

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
  let service: BusinessesService;

  beforeEach(() => {
    tx = {
      business: { create: vi.fn().mockResolvedValue({ id: 'b1' }) },
      user: { update: vi.fn() },
    };
    findFirst = vi.fn();
    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      business: { findFirst },
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
});
