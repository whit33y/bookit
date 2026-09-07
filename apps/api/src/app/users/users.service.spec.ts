import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

// ponytail: UsersService instancjonowany wprost zamiast Test.createTestingModule —
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
  mustChangePassword: false,
  avatarVersion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const changeEmailDto = {
  newEmail: 'nowy@example.com',
  newEmailConfirm: 'nowy@example.com',
  currentPassword: 'poprawne-haslo',
};

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    refreshToken: { deleteMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let notifications: { emailChanged: ReturnType<typeof vi.fn> };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn(), update: vi.fn() },
      refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    notifications = { emailChanged: vi.fn().mockResolvedValue(undefined) };
    service = new UsersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('getMe wybiera profil bez passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    await service.getMe('user-1');

    const arg = prisma.user.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'user-1' });
    expect(arg.select.passwordHash).toBeUndefined();
    expect(arg.select).toMatchObject({ id: true, email: true, role: true });
    // #163: profil niesie wskaźnik na zdjęcie profilowe, nigdy jego bajty
    expect(arg.select.avatarVersion).toBe(true);
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

  describe('changeEmail (#167)', () => {
    const prismaError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue({ id: 'user-1', email: 'nowy@example.com' });
    });

    it('zapisuje znormalizowany adres, kasuje wszystkie refresh tokeny i pisze na stary adres', async () => {
      const result = await service.changeEmail('user-1', {
        ...changeEmailDto,
        // sama wielkość liter, bez spacji wokół: `@IsEmail()` odrzuciłby taki adres na DTO,
        // więc do serwisu i tak by nie dojechał
        newEmail: 'Nowy@Example.COM',
        newEmailConfirm: 'nowy@example.com',
      });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        email: 'nowy@example.com',
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      // jedna transakcja: awaria między zapisami nie może zostawić ważnych sesji przy
      // zmienionym loginie
      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(notifications.emailChanged).toHaveBeenCalledWith(
        'jan@example.com',
        'Jan',
        'nowy@example.com',
      );
      // odpowiedź to profil, nigdy nowa para tokenów — użytkownik jest wylogowany
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(prisma.user.update.mock.calls[0][0].select.passwordHash).toBeUndefined();
    });

    it('powiadomienie idzie dopiero po zapisie', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => {
        order.push('zapis');
        return Promise.all(ops);
      });
      notifications.emailChanged.mockImplementation(() => {
        order.push('mail');
        return Promise.resolve();
      });

      await service.changeEmail('user-1', changeEmailDto);

      expect(order).toEqual(['zapis', 'mail']);
    });

    it('adres zajęty przez inne konto (P2002) → 409', async () => {
      prisma.$transaction.mockRejectedValue(prismaError('P2002'));

      await expect(service.changeEmail('user-1', changeEmailDto)).rejects.toMatchObject({
        status: 409,
      });
      expect(notifications.emailChanged).not.toHaveBeenCalled();
    });

    it('adres równy obecnemu → 400, także gdy różni się wielkością liter', async () => {
      await expect(
        service.changeEmail('user-1', {
          ...changeEmailDto,
          newEmail: 'JAN@example.com',
          newEmailConfirm: 'JAN@example.com',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('błędne hasło → 400, nie 401', async () => {
      await expect(
        service.changeEmail('user-1', { ...changeEmailDto, currentPassword: 'zle' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('niezgodne powtórzenie adresu → 400', async () => {
      await expect(
        service.changeEmail('user-1', {
          ...changeEmailDto,
          newEmailConfirm: 'literowka@example.com',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('powtórzenie różniące się tylko wielkością liter przechodzi — to ten sam login', async () => {
      await expect(
        service.changeEmail('user-1', {
          ...changeEmailDto,
          newEmailConfirm: 'Nowy@Example.com',
        }),
      ).resolves.toBeDefined();
    });

    it('usunięty user (ważny token) → 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.changeEmail('user-1', changeEmailDto)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('user zniknął między odczytem a zapisem (P2025) → 404', async () => {
      prisma.$transaction.mockRejectedValue(prismaError('P2025'));

      await expect(service.changeEmail('user-1', changeEmailDto)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
