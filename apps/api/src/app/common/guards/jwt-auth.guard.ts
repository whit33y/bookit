import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PASSWORD_CHANGE_ALLOWED_KEY } from '../decorators/password-change.decorator';
import { AuthUser } from '../types/auth-user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    // schemat wg RFC 6750 jest case-insensitive
    if (type?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Brak tokenu');
    }

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Nieprawidłowy token');
    }

    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword ?? false,
    };
    this.assertPasswordChanged(ctx, req.user);
    return true;
  }

  /**
   * Wymuszona zmiana hasła (#144). Sprawdzenie siedzi tutaj, bo to jedyny punkt, przez
   * który przechodzi **każde** uwierzytelnione żądanie — strażnik globalny (`APP_GUARD`)
   * wykonałby się przed tym guardem kontrolera, więc nie zastałby jeszcze `req.user`.
   * Trasy publiczne nie mają czego blokować: bez tokenu nie ma konta z flagą.
   */
  private assertPasswordChanged(ctx: ExecutionContext, user: AuthUser): void {
    if (!user.mustChangePassword) {
      return;
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(
      PASSWORD_CHANGE_ALLOWED_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!allowed) {
      throw new ForbiddenException('Musisz zmienić hasło, zanim zrobisz cokolwiek innego');
    }
  }
}
