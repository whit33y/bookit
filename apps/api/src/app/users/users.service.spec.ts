import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('getMe wybiera profil bez passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    await service.getMe('user-1');

    const arg = prisma.user.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.select.passwordHash).toBeUndefined();
    expect(arg.select).toMatchObject({ id: true, email: true, role: true });
  });

  it('getMe dla usuniętego usera (ważny token) → 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe('user-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('updateMe zapisuje tylko pola dto i zwraca profil bez passwordHash', async () => {
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    await service.updateMe('user-1', { firstName: 'Anna' });

    const arg = prisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.data).toEqual({ firstName: 'Anna' });
    expect(arg.select.passwordHash).toBeUndefined();
  });

  it('updateMe dla usuniętego usera (P2025) → 404', async () => {
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.updateMe('user-1', { firstName: 'Anna' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
