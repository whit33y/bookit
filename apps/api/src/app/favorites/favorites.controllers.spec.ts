import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types/auth-user';
import { BusinessFavoriteController } from './business-favorite.controller';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

const client = { sub: 'u1' } as AuthUser;

// Cztery trasy ulubionych: klasa kontrolera i jej handler, czyli dokładnie to, co dostaje
// Reflector w czasie żądania.
const write = BusinessFavoriteController.prototype;
const read = FavoritesController.prototype;

const ROUTES = [
  {
    name: 'PUT /businesses/:id/favorite',
    controller: BusinessFavoriteController,
    handler: write.add,
  },
  {
    name: 'DELETE /businesses/:id/favorite',
    controller: BusinessFavoriteController,
    handler: write.remove,
  },
  { name: 'GET /favorites', controller: FavoritesController, handler: read.list },
  { name: 'GET /favorites/ids', controller: FavoritesController, handler: read.listIds },
];

// ExecutionContext, który wskazuje na prawdziwy handler i prawdziwą klasę — dekorator @Roles
// wisi tu na klasie, więc test przechodzi przez getAllAndOverride tak jak Nest.
const ctxFor = (
  { controller, handler }: (typeof ROUTES)[number],
  role: UserRole,
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', role } }) }),
    getHandler: () => handler,
    getClass: () => controller,
  }) as unknown as ExecutionContext;

describe('kontrolery ulubionych (#181)', () => {
  let favorites: Record<
    'add' | 'remove' | 'list' | 'listIds',
    ReturnType<typeof vi.fn>
  >;
  let writeController: BusinessFavoriteController;
  let readController: FavoritesController;

  beforeEach(() => {
    favorites = {
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      listIds: vi.fn().mockResolvedValue({ ids: [] }),
    };
    writeController = new BusinessFavoriteController(
      favorites as unknown as FavoritesService,
    );
    readController = new FavoritesController(favorites as unknown as FavoritesService);
  });

  it('właściciela listy bierze z tokena, a firmę ze ścieżki', async () => {
    await writeController.add(client, 'b1');
    await writeController.remove(client, 'b1');
    await readController.list(client);
    await readController.listIds(client);

    expect(favorites.add).toHaveBeenCalledWith('u1', 'b1');
    expect(favorites.remove).toHaveBeenCalledWith('u1', 'b1');
    expect(favorites.list).toHaveBeenCalledWith('u1');
    expect(favorites.listIds).toHaveBeenCalledWith('u1');
  });

  it('zapis odpowiada 204 bez ciała', () => {
    for (const method of ['add', 'remove'] as const) {
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, BusinessFavoriteController.prototype[method]),
      ).toBe(HttpStatus.NO_CONTENT);
    }
  });

  // Sam RolesGuard jest przetestowany w common/guards; tutaj puszczamy go przez metadane tych
  // konkretnych tras, żeby AC #181 („wszystkie cztery dają 403 dla OWNER, EMPLOYEE i ADMIN")
  // było sprawdzone zachowaniem, a nie tylko obecnością dekoratora.
  describe('RolesGuard na trasach ulubionych', () => {
    const guard = new RolesGuard(new Reflector());

    it.each(ROUTES)('$name przepuszcza klienta', (route) => {
      expect(guard.canActivate(ctxFor(route, UserRole.CLIENT))).toBe(true);
    });

    it.each(ROUTES)('$name odrzuca pozostałe role 403-ką', (route) => {
      for (const role of [UserRole.OWNER, UserRole.EMPLOYEE, UserRole.ADMIN]) {
        expect(() => guard.canActivate(ctxFor(route, role))).toThrow(
          expect.objectContaining({ status: 403 }),
        );
      }
    });
  });

  // Reguła „tylko klient" siedzi w metadanych guarda, nie w ciele metod — bez tego sprawdzenia
  // usunięcie dekoratora zostawiłoby zielony pakiet testów i ulubione otwarte dla firmy.
  // Dotyczy również odczytu: pozostałe role nie mają ulubionych, więc mają dostać 403,
  // a nie pustą listę.
  it('wszystkie cztery trasy są zamknięte dla wszystkich poza CLIENT-em', () => {
    for (const controller of [BusinessFavoriteController, FavoritesController]) {
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([UserRole.CLIENT]);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    }
  });
});
