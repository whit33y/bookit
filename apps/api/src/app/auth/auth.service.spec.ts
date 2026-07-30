import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../notifications/notifications.service';
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
    user: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    refreshToken: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
    passwordResetToken: {
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let notifications: { sendPasswordReset: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      refreshToken: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      passwordResetToken: {
        create: vi.fn().mockResolvedValue({}),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    notifications = { sendPasswordReset: vi.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({}),
      new ConfigService({
        JWT_SECRET: 'test-secret',
        JWT_REFRESH_SECRET: 'test-refresh',
        APP_URL: 'http://localhost:4200',
      }),
      notifications as unknown as NotificationsService,
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

  describe('forgotPassword', () => {
    // forgotPassword zwraca natychmiast, a praca (lookup, token, mail) leci w tle —
    // flush domyka mikro/makrozadania zanim sprawdzimy efekty
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('nieistniejący email → nie rzuca i nie wysyła maila', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'nikt@example.com' }),
      ).resolves.toBeUndefined();
      await flush();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(notifications.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('istniejący email → zapisuje hash tokenu (TTL ~1 h) i oddaje surowy token do wysyłki', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      await service.forgotPassword({ email: '  JAN@Example.COM ' });
      await flush();

      const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
      // treść maila buduje NotificationsService (#37) — auth przekazuje mu surowy token
      const [to, firstName, token] = notifications.sendPasswordReset.mock.calls[0];

      expect(to).toBe('jan@example.com');
      expect(firstName).toBe('Jan');
      // w mailu jest surowy token, w bazie tylko jego sha256
      expect(created.tokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
      expect(created.tokenHash).not.toBe(token);
      const ttlMs = created.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(55 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
      // stare tokeny usera są sprzątane przy każdym nowym żądaniu
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('resetPassword', () => {
    const p2025 = () =>
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      });

    it('nieznany/zużyty token → BadRequestException (400)', async () => {
      prisma.passwordResetToken.delete.mockRejectedValue(p2025());

      await expect(
        service.resetPassword({ token: 'nieznany', password: 'nowe-haslo-123' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('wygasły token → 400, hasło niezmienione', async () => {
      prisma.passwordResetToken.delete.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword({ token: 'wygasly', password: 'nowe-haslo-123' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('poprawny token → nowy hash hasła i usunięcie wszystkich refresh tokenów usera', async () => {
      prisma.passwordResetToken.delete.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 1000),
      });

      await service.resetPassword({ token: 'ok', password: 'nowe-haslo-123' });

      const updated = prisma.user.update.mock.calls[0][0];
      expect(updated.where).toEqual({ id: 'user-1' });
      expect(updated.data.passwordHash).not.toBe('nowe-haslo-123');
      expect(
        bcrypt.compareSync('nowe-haslo-123', updated.data.passwordHash),
      ).toBe(true);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });
});
