import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { BusinessImageKind, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_SLOTS,
  MAX_IMAGE_BYTES,
  STORED_MIME,
  WEBP_QUALITY,
  isAcceptedImage,
} from './business-image';

/** Skrót treści obrazu: krótki, bo idzie do URL-a jako cache-buster i do ETagu, a nie do
 *  weryfikacji integralności — 16 znaków heksa wystarczy, żeby dwie wersje się rozjechały. */
const versionOf = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/**
 * Wizerunek firmy (#153): normalizacja i przechowywanie logo firmy oraz okładki profilu.
 * Bajty trzymamy w Postgresie — uzasadnienie i konsekwencje w ADR-0001.
 */
@Injectable()
export class BusinessImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wgranie obrazu do slotu właściciela. Firmę wskazuje `ownerId` z tokena, nigdy parametr
   * ścieżki — właściciel nie ma jak dotknąć cudzego wiersza.
   */
  async replaceMine(userId: string, kind: BusinessImageKind, file?: Express.Multer.File) {
    const bytes = this.acceptUpload(file);
    const businessId = await this.ownBusinessId(userId);
    const processed = await this.normalize(bytes, kind);
    const version = versionOf(processed);
    // Prisma opisuje `Bytes` jako Uint8Array; Buffer z sharpa bywa nad SharedArrayBuffer,
    // więc przepisujemy widok zamiast rzutować
    const stored = new Uint8Array(processed);

    // jedna transakcja, bo `logoVersion` na `Business` jest wskaźnikiem na wiersz obok:
    // rozjazd tych dwóch zapisów oznaczałby obraz nie do pobrania albo URL do pustki
    await this.prisma.$transaction([
      this.prisma.businessImage.upsert({
        // @@unique([businessId, kind]) → nadpisanie slotu, nie kolejny wiersz
        where: { businessId_kind: { businessId, kind } },
        create: { businessId, kind, mime: STORED_MIME, version, bytes: stored },
        update: { mime: STORED_MIME, version, bytes: stored },
      }),
      this.setVersion(businessId, kind, version),
    ]);

    return { version };
  }

  /** Usunięcie obrazu ze slotu. Idempotentne: brak obrazu to ten sam stan końcowy, więc 204. */
  async removeMine(userId: string, kind: BusinessImageKind) {
    const businessId = await this.ownBusinessId(userId);
    await this.prisma.$transaction([
      // deleteMany, nie delete — brak wiersza nie jest błędem, `delete` rzuciłoby P2025
      this.prisma.businessImage.deleteMany({ where: { businessId, kind } }),
      this.setVersion(businessId, kind, null),
    ]);
  }

  /**
   * Wersja slotu widziana przez `Business` — tyle wystarczy, żeby odpowiedzieć 304. Osobne
   * zapytanie od bajtów świadomie: przy trafieniu w cache nie zaciągamy z bazy ani kilobajta
   * obrazu. Do ETagu odpowiedzi z treścią służy wersja z `findBytes`, nie ta.
   */
  async findVersion(businessId: string, kind: BusinessImageKind): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      // statycznie oba pola zamiast klucza wyliczanego: Prisma zachowuje wtedy wnioskowanie typu
      select: { logoVersion: true, coverVersion: true },
    });
    const version = business?.[IMAGE_SLOTS[kind].versionField];
    if (!version) {
      throw new NotFoundException('Nie znaleziono obrazu');
    }
    return version;
  }

  /** Bajty razem z ich własną wersją — ETag odpowiedzi musi opisywać to, co w niej jedzie. */
  async findBytes(businessId: string, kind: BusinessImageKind) {
    const image = await this.prisma.businessImage.findUnique({
      where: { businessId_kind: { businessId, kind } },
      select: { mime: true, version: true, bytes: true },
    });
    if (!image) {
      throw new NotFoundException('Nie znaleziono obrazu');
    }
    return image;
  }

  /** Bramka wejściowa: obecność pliku, rozmiar i format po sygnaturze. */
  private acceptUpload(file?: Express.Multer.File): Buffer {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Nie przesłano pliku');
    }
    // multer urywa większe żądanie wcześniej; ten warunek trzyma regułę także wtedy,
    // gdy serwis wywoła coś innego niż kontroler z tym interceptorem
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Obraz może mieć najwyżej 5 MB');
    }
    if (!isAcceptedImage(file.buffer)) {
      throw new UnsupportedMediaTypeException('Dozwolone formaty to JPEG, PNG i WebP');
    }
    return file.buffer;
  }

  /**
   * Kadrowanie do docelowych wymiarów i konwersja na WebP. `sharp` domyślnie nie przepisuje
   * EXIF-u, więc metadane aparatu (w tym GPS) znikają razem z oryginałem — trzymamy tylko wynik.
   */
  private async normalize(bytes: Buffer, kind: BusinessImageKind): Promise<Buffer> {
    const { width, height } = IMAGE_SLOTS[kind];
    try {
      return await sharp(bytes)
        .resize({ width, height, fit: 'cover' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      // sygnatura się zgadzała, ale treść jest ucięta albo uszkodzona — to nie jest
      // „zły typ pliku", więc 422, nie 415
      throw new UnprocessableEntityException('Nie udało się odczytać obrazu');
    }
  }

  /** Wskaźnik na `Business`: hash treści albo `null`, gdy slot jest pusty. */
  private setVersion(businessId: string, kind: BusinessImageKind, version: string | null) {
    return this.prisma.business.update({
      where: { id: businessId },
      data: { [IMAGE_SLOTS[kind].versionField]: version } satisfies Prisma.BusinessUpdateInput,
    });
  }

  /** `ownerId` jest @unique — z tokena wychodzi dokładnie jedna firma albo żadna. */
  private async ownBusinessId(userId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('Nie znaleziono firmy');
    }
    return business.id;
  }
}
