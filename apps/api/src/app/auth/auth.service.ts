import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

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

const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
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

  private async issueTokens(user: User): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
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
