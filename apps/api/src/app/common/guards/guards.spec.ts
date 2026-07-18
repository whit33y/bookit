import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
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
  const guard = new JwtAuthGuard(jwt, config);

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
