import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD_CHANGE_ALLOWED_KEY } from '../decorators/password-change.decorator';
import { AuthUser } from '../types/auth-user';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

// ponytail: guardy instancjonowane wprost — vitest/esbuild nie emituje
// decorator metadata wymaganej przez DI Nesta (jak w auth.service.spec)
const JWT_SECRET = 'test-secret';

// minimalny ExecutionContext oparty na fake requeście
const ctxWith = (req: Record<string, unknown>, meta?: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => meta,
    getClass: () => meta,
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({});
  const config = new ConfigService({ JWT_SECRET });
  const guard = new JwtAuthGuard(jwt, config, new Reflector());

  const token = (payload: AuthUser) =>
    jwt.sign(payload, { secret: JWT_SECRET, expiresIn: '15m' });

  it('brak nagłówka Authorization → 401', async () => {
    await expect(
      guard.canActivate(ctxWith({ headers: {} })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('zły podpis → 401', async () => {
    await expect(
      guard.canActivate(
        ctxWith({ headers: { authorization: 'Bearer nie-jwt' } }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('ważny token → true i req.user ustawione z payloadu', async () => {
    const req: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${token({
          sub: 'user-1',
          email: 'jan@example.com',
          role: 'CLIENT',
        })}`,
      },
    };

    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user).toEqual({
      sub: 'user-1',
      email: 'jan@example.com',
      role: 'CLIENT',
      mustChangePassword: false,
    });
  });

  describe('wymuszona zmiana hasła (#144)', () => {
    // trasa oznaczona @AllowedDuringPasswordChange() — metadane podpięte wprost do handlera
    const handler = (allowed: boolean) => {
      const meta = () => undefined;
      if (allowed) Reflect.defineMetadata(PASSWORD_CHANGE_ALLOWED_KEY, true, meta);
      return meta;
    };

    const requestWithFlag = (mustChangePassword: boolean) => ({
      headers: {
        authorization: `Bearer ${token({
          sub: 'user-1',
          email: 'admin@example.com',
          role: 'ADMIN',
          mustChangePassword,
        })}`,
      },
    });

    it('konto z flagą → 403 na zwykłej trasie', async () => {
      await expect(
        guard.canActivate(ctxWith(requestWithFlag(true), handler(false))),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('konto z flagą przechodzi na trasie dozwolonej podczas zmiany hasła', async () => {
      await expect(
        guard.canActivate(ctxWith(requestWithFlag(true), handler(true))),
      ).resolves.toBe(true);
    });

    it('konto bez flagi przechodzi wszędzie', async () => {
      await expect(
        guard.canActivate(ctxWith(requestWithFlag(false), handler(false))),
      ).resolves.toBe(true);
    });

    it('token sprzed #144 (bez claimu) nie blokuje', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { sub: 'user-1', email: 'jan@example.com', role: 'CLIENT' },
            { secret: JWT_SECRET, expiresIn: '15m' },
          )}`,
        },
      };

      await expect(guard.canActivate(ctxWith(req, handler(false)))).resolves.toBe(true);
    });
  });
});

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const withRoles = (roles: UserRole[] | undefined, role: UserRole) => {
    const meta = () => undefined;
    // Reflector czyta metadane z handlera — podpinamy je bezpośrednio
    if (roles) Reflect.defineMetadata('roles', roles, meta);
    return ctxWith({ user: { sub: 'u', email: 'e', role } }, meta);
  };

  it('brak @Roles → przepuszcza (true)', () => {
    expect(guard.canActivate(withRoles(undefined, 'CLIENT'))).toBe(true);
  });

  it('pasująca rola → true', () => {
    expect(guard.canActivate(withRoles(['OWNER', 'ADMIN'], 'ADMIN'))).toBe(true);
  });

  it('niewystarczająca rola → 403', () => {
    expect(() => guard.canActivate(withRoles(['ADMIN'], 'CLIENT'))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});
