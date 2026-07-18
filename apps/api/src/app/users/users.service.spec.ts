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

  it('getMe wybiera profil bez passwordHash', () => {
    service.getMe('user-1');

    const arg = prisma.user.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.select.passwordHash).toBeUndefined();
    expect(arg.select).toMatchObject({ id: true, email: true, role: true });
  });

  it('updateMe zapisuje tylko pola dto i zwraca profil bez passwordHash', () => {
    service.updateMe('user-1', { firstName: 'Anna' });

    const arg = prisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.data).toEqual({ firstName: 'Anna' });
    expect(arg.select.passwordHash).toBeUndefined();
  });
});
