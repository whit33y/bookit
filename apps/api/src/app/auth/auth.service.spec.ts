import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

// compare owinięte w spy delegujący do prawdziwej implementacji — reszta testów
// używa realnego bcrypt, a możemy sprawdzić, że compare jest wołane też bez usera
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

// ponytail: AuthService instancjonowany wprost zamiast Test.createTestingModule —
// vitest/esbuild nie emituje decorator metadata wymaganej przez DI Nesta
const user = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'jan@example.com',
  passwordHash: bcrypt.hashSync('poprawne-haslo', 4),
  firstName: 'Jan',
  lastName: 'Kowalski',
  phone: null,
  role: 'CLIENT',
  isBlocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthService', () => {
  let prisma: {
    user: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    refreshToken: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: { create: vi.fn(), findUnique: vi.fn() },
      refreshToken: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({}),
      new ConfigService({ JWT_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh' }),
    );
  });

  describe('register', () => {
    it('tworzy usera i zwraca parę tokenów', async () => {
      prisma.user.create.mockResolvedValue(user());

      const tokens = await service.register({
        email: '  JAN@Example.COM ',
        password: 'poprawne-haslo',
        firstName: 'Jan',
        lastName: 'Kowalski',
      });

      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(prisma.refreshToken.create).toHaveBeenCalledOnce();
      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.passwordHash).not.toBe('poprawne-haslo');
      expect(created.email).toBe('jan@example.com');
    });

    it('duplikat emaila → ConflictException (409)', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.register({
          email: 'jan@example.com',
          password: 'poprawne-haslo',
          firstName: 'Jan',
          lastName: 'Kowalski',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('login', () => {
    it('poprawne dane → para tokenów', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      const tokens = await service.login({
        email: 'jan@example.com',
        password: 'poprawne-haslo',
      });

      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
    });

    it('nieznany email i złe hasło → 401 z tym samym komunikatem', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const unknownEmail = await service
        .login({ email: 'nikt@example.com', password: 'x' })
        .catch((e) => e);

      prisma.user.findUnique.mockResolvedValue(user());
      const badPassword = await service
        .login({ email: 'jan@example.com', password: 'zle-haslo' })
        .catch((e) => e);

      expect(unknownEmail.status).toBe(401);
      expect(badPassword.status).toBe(401);
      expect(unknownEmail.message).toBe(badPassword.message);
    });

    it('przy nieznanym emailu i tak wykonuje bcrypt.compare (ochrona przed timing-atakiem)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      vi.mocked(bcrypt.compare).mockClear();

      await service
        .login({ email: 'nikt@example.com', password: 'x' })
        .catch(() => undefined);

      expect(bcrypt.compare).toHaveBeenCalledOnce();
    });

    it('normalizuje email (trim + lowercase) przed wyszukaniem', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      await service.login({
        email: '  JAN@Example.COM ',
        password: 'poprawne-haslo',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jan@example.com' },
      });
    });

    it('zablokowany user → ForbiddenException (403)', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ isBlocked: true }));

      await expect(
        service.login({ email: 'jan@example.com', password: 'poprawne-haslo' }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('refresh', () => {
    const issueAndGrabToken = async () => {
      prisma.user.create.mockResolvedValue(user());
      const { refreshToken } = await service.register({
        email: 'jan@example.com',
        password: 'poprawne-haslo',
        firstName: 'Jan',
        lastName: 'Kowalski',
      });
      return refreshToken;
    };

    it('ważny token → rotacja: stary hash usunięty, nowy zapisany, nowa para', async () => {
      const refreshToken = await issueAndGrabToken();
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.refreshToken.create.mockClear();
      prisma.refreshToken.deleteMany.mockClear();

      const tokens = await service.refresh(refreshToken);

      // rotacja usuwa dokładnie stary token po jego haszu
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          tokenHash: expect.any(String),
          expiresAt: { gt: expect.any(Date) },
        },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledOnce();
      expect(tokens.refreshToken).not.toBe(refreshToken);
      expect(tokens.accessToken).toBeTruthy();
    });

    it('nieznany/unieważniony/wygasły w DB token → 401', async () => {
      const refreshToken = await issueAndGrabToken();
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('token o złym podpisie → 401', async () => {
      await expect(service.refresh('nie-jwt')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('zablokowany user → 401', async () => {
      const refreshToken = await issueAndGrabToken();
      prisma.user.findUnique.mockResolvedValue(user({ isBlocked: true }));

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});
