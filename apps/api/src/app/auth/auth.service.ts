import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { hashPassword, normalizeEmail } from '../common/credentials';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// stały hash o tym samym koszcie co produkcyjny — porównanie przy nieistniejącym
// userze zajmuje tyle samo czasu co przy istniejącym, więc czas odpowiedzi nie
// zdradza, czy konto istnieje
const DUMMY_PASSWORD_HASH =
  '$2b$10$AW9FsaUHFQ3gAJfUnxcPLu5t7ETXO5QIHibbcpe0jElJePlAcfs2i';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await hashPassword(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizeEmail(dto.email),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
      return this.issueTokens(user);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Konto z tym adresem email już istnieje');
      }
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
    });
    // porównanie wykonywane zawsze (dummy hash gdy brak usera), by czas odpowiedzi
    // nie ujawniał istnienia konta
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Nieprawidłowy email lub hasło');
    }
    if (user.isBlocked) {
      throw new ForbiddenException('Konto jest zablokowane');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Nieprawidłowy refresh token');
    }

    // rotacja: usunięcie starego hasha; count 0 = token nieznany/unieważniony/wygasły w DB
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: sha256(refreshToken), expiresAt: { gt: new Date() } },
    });
    if (count === 0) {
      throw new UnauthorizedException('Nieprawidłowy refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.isBlocked) {
      throw new UnauthorizedException('Nieprawidłowy refresh token');
    }
    return this.issueTokens(user);
  }

  // Zwraca natychmiast i w stałym czasie — cała praca zależna od istnienia konta
  // (lookup, token, mail) idzie w tło, więc ani kod odpowiedzi, ani czas nie
  // zdradzają, czy email jest w bazie.
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    void this.deliverPasswordReset(normalizeEmail(dto.email)).catch((err) =>
      this.logger.error(`Nie udało się obsłużyć resetu hasła: ${err}`),
    );
  }

  private async deliverPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    // Treść i link żyją w module notifications (#37) — auth odpowiada tylko za token.
    await this.notifications.sendPasswordReset(user.email, user.firstName, token);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // delete zwraca rekord i gwarantuje jednorazowość; P2025 = token nieznany/zużyty
    let resetToken: { userId: string; expiresAt: Date };
    try {
      resetToken = await this.prisma.passwordResetToken.delete({
        where: { tokenHash: sha256(dto.token) },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new BadRequestException('Nieprawidłowy lub wygasły token');
      }
      throw e;
    }
    if (resetToken.expiresAt <= new Date()) {
      throw new BadRequestException('Nieprawidłowy lub wygasły token');
    }

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      // reset unieważnia wszystkie sesje — stare refresh tokeny przestają działać
      this.prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);
  }

  /**
   * Zmiana hasła przez zalogowanego użytkownika — także jedyne wyjście dla konta
   * z `mustChangePassword` (#144), które poza tą trasą i własnym profilem dostaje 403.
   *
   * Odpowiedź to nowa para tokenów, a nie samo „ok": flaga jedzie w access tokenie, więc
   * bez wymiany użytkownik zostałby zablokowany własnym, wciąż ważnym tokenem aż do jego
   * wygaśnięcia.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Nie znaleziono użytkownika');
    }
    // 400, nie 401: 401 jest dla „token nie działa" i frontowy interceptor odpowiada na nie
    // wylogowaniem, a literówka w starym haśle ma zostać literówką w formularzu
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Nieprawidłowe obecne hasło');
    }

    // Bez tego konto z wymuszoną zmianą hasła (#144) odblokowałoby się, oddając to samo
    // hasło, które ustawił mu ktoś inny — a flaga istnieje właśnie po to, żeby hasło znane
    // osobie trzeciej przestało działać.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('Nowe hasło musi różnić się od obecnego');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    // jedna transakcja jak w resetPassword: awaria między zapisami nie może zostawić
    // ważnych refresh tokenów przy zmienionym haśle
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      // zmiana hasła unieważnia pozostałe sesje — hasło zmienia się także wtedy, gdy ktoś
      // podejrzewa, że zna je ktoś inny; wywołujący dostaje w zamian nową parę tokenów
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);
    return this.issueTokens(updated);
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: ACCESS_TOKEN_TTL,
      },
    );
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
      },
    );
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt },
    });
    // sprzątanie wygasłych tokenów tego usera przy każdym wydaniu pary
    // ponytail: prune per-user; globalny cron dopiero gdyby okazał się potrzebny
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lte: new Date() } },
    });
    return { accessToken, refreshToken };
  }
}
