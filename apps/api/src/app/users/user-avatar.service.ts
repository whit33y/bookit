import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  STORED_MIME,
  acceptUpload,
  normalizeImage,
  toStoredBytes,
  versionOf,
} from '../common/images/image-upload';
import { PrismaService } from '../prisma/prisma.service';

/** Kwadrat jak logo firmy: zdjęcie profilowe pokazuje się w kółku przy nazwisku, nigdy w pasie. */
export const AVATAR_SIZE = { width: 512, height: 512 };

/**
 * Zdjęcie profilowe (#163): normalizacja i przechowywanie obrazu osoby stojącej za kontem.
 * Bajty trzymamy w Postgresie — uzasadnienie i konsekwencje w ADR-0001.
 *
 * Wzorzec ten sam, co przy wizerunku firmy (#153), ale bez pojęcia slotu: osoba ma jedno
 * zdjęcie, więc kluczem jest samo `userId`.
 */
@Injectable()
export class UserAvatarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wgranie zdjęcia. Konto wskazuje `sub` z tokena, nigdy parametr ścieżki — zalogowany nie
   * ma jak dotknąć cudzego wiersza żadną trasą.
   */
  async replaceMine(userId: string, file?: Express.Multer.File) {
    const bytes = acceptUpload(file);
    const processed = await normalizeImage(bytes, AVATAR_SIZE);
    const version = versionOf(processed);
    const stored = toStoredBytes(processed);

    // jedna transakcja, bo `avatarVersion` na `User` jest wskaźnikiem na wiersz obok:
    // rozjazd tych dwóch zapisów oznaczałby obraz nie do pobrania albo URL do pustki
    await this.missingUserIsNotFound(
      this.prisma.$transaction([
        this.prisma.userImage.upsert({
          // userId jest @unique → nadpisanie zdjęcia, nie kolejny wiersz
          where: { userId },
          create: { userId, mime: STORED_MIME, version, bytes: stored },
          update: { mime: STORED_MIME, version, bytes: stored },
        }),
        this.setVersion(userId, version),
      ]),
    );

    return { version };
  }

  /** Usunięcie zdjęcia. Idempotentne: brak zdjęcia to ten sam stan końcowy, więc 204. */
  async removeMine(userId: string) {
    await this.missingUserIsNotFound(
      this.prisma.$transaction([
        // deleteMany, nie delete — brak wiersza nie jest błędem, `delete` rzuciłoby P2025
        this.prisma.userImage.deleteMany({ where: { userId } }),
        this.setVersion(userId, null),
      ]),
    );
  }

  /**
   * Wersja widziana przez `User` — tyle wystarczy, żeby odpowiedzieć 304. Osobne zapytanie
   * od bajtów świadomie: przy trafieniu w cache nie zaciągamy z bazy ani kilobajta obrazu.
   * Do ETagu odpowiedzi z treścią służy wersja z `findBytes`, nie ta.
   */
  async findVersion(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarVersion: true },
    });
    if (!user?.avatarVersion) {
      throw new NotFoundException('Nie znaleziono obrazu');
    }
    return user.avatarVersion;
  }

  /** Bajty razem z ich własną wersją — ETag odpowiedzi musi opisywać to, co w niej jedzie. */
  async findBytes(userId: string) {
    const image = await this.prisma.userImage.findUnique({
      where: { userId },
      select: { mime: true, version: true, bytes: true },
    });
    if (!image) {
      throw new NotFoundException('Nie znaleziono obrazu');
    }
    return image;
  }

  /** Wskaźnik na `User`: hash treści albo `null`, gdy konto nie ma zdjęcia. */
  private setVersion(userId: string, version: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarVersion: version } satisfies Prisma.UserUpdateInput,
    });
  }

  /**
   * Ważny token konta usuniętego w międzyczasie: `User.update` rzuca P2025, a `UserImage`
   * łamie klucz obcy (P2003). Jedno i drugie znaczy „nie ma takiego użytkownika", więc 404,
   * a nie 500 — tak samo jak `UsersService.getMe`.
   */
  private async missingUserIsNotFound<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === 'P2025' || e.code === 'P2003')
      ) {
        throw new NotFoundException('Nie znaleziono użytkownika');
      }
      throw e;
    }
  }
}
