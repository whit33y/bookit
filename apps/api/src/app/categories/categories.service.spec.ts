import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let prisma: { category: { findMany: ReturnType<typeof vi.fn> } };
  let service: CategoriesService;

  beforeEach(() => {
    prisma = { category: { findMany: vi.fn() } };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  it('findAll wybiera id/name/slug, sortuje po name i zwraca wynik Prismy', async () => {
    const rows = [{ id: 'c1', name: 'Barber', slug: 'barber' }];
    prisma.category.findMany.mockResolvedValue(rows);

    const result = await service.findAll();

    const arg = prisma.category.findMany.mock.calls[0][0];
    expect(arg.select).toEqual({ id: true, name: true, slug: true });
    expect(arg.orderBy).toEqual({ name: 'asc' });
    expect(result).toBe(rows);
  });
});
