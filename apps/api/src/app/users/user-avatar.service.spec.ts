import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES } from '../common/images/image-upload';
import { PrismaService } from '../prisma/prisma.service';
import { UserAvatarService } from './user-avatar.service';

/** Prawdziwy obraz wejściowy — konwersję sprawdzamy na wyniku sharpa, nie na atrapie. */
const source = (format: 'jpeg' | 'png' | 'webp', background = { r: 200, g: 30, b: 90 }) =>
  // prostokąt, żeby było widać, że kadrowanie do kwadratu naprawdę zachodzi
  sharp({ create: { width: 300, height: 100, channels: 3, background } })[format]().toBuffer();

/** Plik z multera; `mimetype` bywa kłamstwem klienta, więc testy podają go celowo „poprawny". */
const upload = (buffer: Buffer, mimetype = 'image/png') =>
  ({ buffer, mimetype, size: buffer.length }) as Express.Multer.File;

describe('UserAvatarService (#163)', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let userUpdate: ReturnType<typeof vi.fn>;
  let imageUpsert: ReturnType<typeof vi.fn>;
  let imageDeleteMany: ReturnType<typeof vi.fn>;
  let imageFindUnique: ReturnType<typeof vi.fn>;
  let service: UserAvatarService;

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue({ avatarVersion: 'abc123' });
    userUpdate = vi.fn().mockResolvedValue({});
    imageUpsert = vi.fn().mockResolvedValue({});
    imageDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    imageFindUnique = vi.fn();
    const prisma = {
      // atrapa transakcji: zapytania w tablicy i tak są już wywołane, chodzi o samo opakowanie
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      user: { findUnique: userFindUnique, update: userUpdate },
      userImage: {
        upsert: imageUpsert,
        deleteMany: imageDeleteMany,
        findUnique: imageFindUnique,
      },
    };
    service = new UserAvatarService(prisma as unknown as PrismaService);
  });

  describe('wgranie zdjęcia', () => {
    it('odrzuca żądanie bez pliku (400)', async () => {
      await expect(service.replaceMine('u1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(imageUpsert).not.toHaveBeenCalled();
    });

    it('odrzuca plik ponad 5 MB (413)', async () => {
      // sygnatura PNG na początku, żeby odpaść na rozmiarze, a nie na typie
      const oversized = Buffer.concat([await source('png'), Buffer.alloc(MAX_IMAGE_BYTES)]);
      await expect(service.replaceMine('u1', upload(oversized))).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(imageUpsert).not.toHaveBeenCalled();
    });

    it('odrzuca format spoza JPEG/PNG/WebP mimo nagłówka image/png (415)', async () => {
      const pdf = Buffer.from('%PDF-1.7\nnie jestem obrazem');
      await expect(service.replaceMine('u1', upload(pdf, 'image/png'))).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
    });

    it('odrzuca plik z poprawną sygnaturą, ale uszkodzoną treścią (422)', async () => {
      const truncated = (await source('png')).subarray(0, 40);
      await expect(service.replaceMine('u1', upload(truncated))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('zapisuje zdjęcie jako WebP 512×512 niezależnie od formatu wejścia', async () => {
      await service.replaceMine('u1', upload(await source('jpeg')));

      const stored = imageUpsert.mock.calls[0][0].create.bytes;
      const meta = await sharp(Buffer.from(stored)).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([512, 512]);
    });

    it('nadpisuje zdjęcie zamiast dokładać wiersz i zwraca nową wersję', async () => {
      const result = await service.replaceMine('u1', upload(await source('png')));

      expect(imageUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatarVersion: result.version },
      });
      expect(result.version).toMatch(/^[0-9a-f]{16}$/);
      // ta sama wersja ląduje przy bajtach — bez tego ETag musiałby ufać wskaźnikowi z User
      expect(imageUpsert.mock.calls[0][0].create.version).toBe(result.version);
      expect(imageUpsert.mock.calls[0][0].update.version).toBe(result.version);
    });

    it('daje tę samą wersję dla tej samej treści, inną dla innej', async () => {
      const png = await source('png');
      const first = await service.replaceMine('u1', upload(png));
      const same = await service.replaceMine('u1', upload(png));
      const other = await service.replaceMine(
        'u1',
        // inny kolor, nie inne wymiary: po kadrowaniu do 512×512 sam rozmiar wejścia
        // dałby bajt w bajt ten sam obraz, a więc i tę samą wersję
        upload(await source('png', { r: 10, g: 120, b: 200 })),
      );

      expect(same.version).toBe(first.version);
      expect(other.version).not.toBe(first.version);
    });

    it('ważny token usuniętego użytkownika kończy się 404, nie błędem klucza obcego', async () => {
      userUpdate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      await expect(service.replaceMine('u1', upload(await source('png')))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('usunięcie zdjęcia', () => {
    it('kasuje wiersz i zeruje wersję na koncie', async () => {
      await service.removeMine('u1');

      expect(imageDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatarVersion: null },
      });
    });

    it('kończy się powodzeniem także wtedy, gdy konto nie ma zdjęcia', async () => {
      imageDeleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeMine('u1')).resolves.toBeUndefined();
    });
  });

  describe('odczyt publiczny', () => {
    it('zwraca wersję z konta', async () => {
      await expect(service.findVersion('u1')).resolves.toBe('abc123');
      expect(userFindUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { avatarVersion: true },
      });
    });

    it('konto bez zdjęcia jest nie do odróżnienia od nieistniejącego — 404', async () => {
      userFindUnique.mockResolvedValue({ avatarVersion: null });
      await expect(service.findVersion('u1')).rejects.toBeInstanceOf(NotFoundException);

      userFindUnique.mockResolvedValue(null);
      await expect(service.findVersion('u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('zaciąga bajty dopiero osobnym zapytaniem', async () => {
      imageFindUnique.mockResolvedValue({
        mime: 'image/webp',
        version: 'abc123',
        bytes: new Uint8Array([1, 2]),
      });
      const image = await service.findBytes('u1');

      expect(imageFindUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { mime: true, version: true, bytes: true },
      });
      // wersja jedzie razem z bajtami — ETag odpowiedzi opisuje to, co w niej jest
      expect(image).toMatchObject({ mime: 'image/webp', version: 'abc123' });
    });

    it('brak wiersza z bajtami to 404', async () => {
      imageFindUnique.mockResolvedValue(null);
      await expect(service.findBytes('u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
