import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { BusinessImageKind } from '@prisma/client';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_IMAGE_BYTES } from './business-image';
import { BusinessImagesService } from './business-images.service';

/** Prawdziwy obraz wejściowy — konwersję sprawdzamy na wyniku sharpa, nie na atrapie. */
const source = (
  format: 'jpeg' | 'png' | 'webp',
  background = { r: 200, g: 30, b: 90 },
  { width, height } = { width: 300, height: 100 },
) =>
  sharp({ create: { width, height, channels: 3, background } })
    [format]()
    .toBuffer();

/** Plik z multera; `mimetype` bywa kłamstwem klienta, więc testy podają go celowo „poprawny". */
const upload = (buffer: Buffer, mimetype = 'image/png') =>
  ({ buffer, mimetype, size: buffer.length }) as Express.Multer.File;

describe('BusinessImagesService (#153)', () => {
  let businessFindUnique: ReturnType<typeof vi.fn>;
  let businessUpdate: ReturnType<typeof vi.fn>;
  let imageUpsert: ReturnType<typeof vi.fn>;
  let imageDeleteMany: ReturnType<typeof vi.fn>;
  let imageFindUnique: ReturnType<typeof vi.fn>;
  let service: BusinessImagesService;

  beforeEach(() => {
    businessFindUnique = vi.fn().mockResolvedValue({ id: 'b1' });
    businessUpdate = vi.fn().mockResolvedValue({});
    imageUpsert = vi.fn().mockResolvedValue({});
    imageDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    imageFindUnique = vi.fn();
    const prisma = {
      // atrapa transakcji: zapytania w tablicy i tak są już wywołane, chodzi o samo opakowanie
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      business: { findUnique: businessFindUnique, update: businessUpdate },
      businessImage: {
        upsert: imageUpsert,
        deleteMany: imageDeleteMany,
        findUnique: imageFindUnique,
      },
    };
    service = new BusinessImagesService(prisma as unknown as PrismaService);
  });

  describe('wgranie obrazu', () => {
    it('odrzuca żądanie bez pliku (400)', async () => {
      await expect(
        service.replaceMine('u1', BusinessImageKind.LOGO, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(imageUpsert).not.toHaveBeenCalled();
    });

    it('odrzuca plik ponad 5 MB (413)', async () => {
      const png = await source('png');
      // sygnatura PNG na początku, żeby odpaść na rozmiarze, a nie na typie
      const oversized = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]);
      await expect(
        service.replaceMine('u1', BusinessImageKind.LOGO, upload(oversized)),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(imageUpsert).not.toHaveBeenCalled();
    });

    it('odrzuca format spoza JPEG/PNG/WebP mimo nagłówka image/png (415)', async () => {
      const pdf = Buffer.from('%PDF-1.7\nnie jestem obrazem');
      await expect(
        service.replaceMine('u1', BusinessImageKind.LOGO, upload(pdf, 'image/png')),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it('odrzuca plik z poprawną sygnaturą, ale uszkodzoną treścią (422)', async () => {
      const png = await source('png');
      const truncated = png.subarray(0, 40);
      await expect(
        service.replaceMine('u1', BusinessImageKind.LOGO, upload(truncated)),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('zapisuje logo jako WebP 512×512 niezależnie od formatu wejścia', async () => {
      await service.replaceMine('u1', BusinessImageKind.LOGO, upload(await source('jpeg')));

      const stored = imageUpsert.mock.calls[0][0].create.bytes;
      const meta = await sharp(Buffer.from(stored)).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([512, 512]);
    });

    it('zapisuje okładkę jako WebP 1600×400', async () => {
      await service.replaceMine('u1', BusinessImageKind.COVER, upload(await source('png')));

      const stored = imageUpsert.mock.calls[0][0].create.bytes;
      const meta = await sharp(Buffer.from(stored)).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([1600, 400]);
    });

    it('nadpisuje istniejący slot zamiast dokładać wiersz i zwraca nową wersję', async () => {
      const result = await service.replaceMine(
        'u1',
        BusinessImageKind.LOGO,
        upload(await source('png')),
      );

      expect(imageUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId_kind: { businessId: 'b1', kind: BusinessImageKind.LOGO } },
        }),
      );
      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { logoVersion: result.version },
      });
      expect(result.version).toMatch(/^[0-9a-f]{16}$/);
      // ta sama wersja ląduje przy bajtach — bez tego ETag musiałby ufać wskaźnikowi z Business
      expect(imageUpsert.mock.calls[0][0].create.version).toBe(result.version);
      expect(imageUpsert.mock.calls[0][0].update.version).toBe(result.version);
    });

    it('daje tę samą wersję dla tej samej treści, inną dla innej', async () => {
      const png = await source('png');
      const first = await service.replaceMine('u1', BusinessImageKind.LOGO, upload(png));
      const same = await service.replaceMine('u1', BusinessImageKind.LOGO, upload(png));
      const other = await service.replaceMine(
        'u1',
        BusinessImageKind.LOGO,
        // inny kolor, nie inne wymiary: po kadrowaniu do 512×512 sam rozmiar wejścia
        // dałby bajt w bajt ten sam obraz, a więc i tę samą wersję
        upload(await source('png', { r: 10, g: 120, b: 200 })),
      );

      expect(same.version).toBe(first.version);
      expect(other.version).not.toBe(first.version);
    });

    it('OWNER bez firmy dostaje 404, zanim cokolwiek zapiszemy', async () => {
      businessFindUnique.mockResolvedValue(null);
      await expect(
        service.replaceMine('u1', BusinessImageKind.LOGO, upload(await source('png'))),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(imageUpsert).not.toHaveBeenCalled();
    });
  });

  describe('usunięcie obrazu', () => {
    it('kasuje wiersz i zeruje wersję na firmie', async () => {
      await service.removeMine('u1', BusinessImageKind.COVER);

      expect(imageDeleteMany).toHaveBeenCalledWith({
        where: { businessId: 'b1', kind: BusinessImageKind.COVER },
      });
      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { coverVersion: null },
      });
    });

    it('kończy się powodzeniem także wtedy, gdy firma nie ma obrazu', async () => {
      imageDeleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeMine('u1', BusinessImageKind.LOGO)).resolves.toBeUndefined();
    });
  });

  describe('odczyt publiczny', () => {
    it('zwraca wersję ze slotu firmy', async () => {
      businessFindUnique.mockResolvedValue({ logoVersion: 'abc123', coverVersion: null });
      await expect(service.findVersion('b1', BusinessImageKind.LOGO)).resolves.toBe('abc123');
    });

    it('firma bez obrazu jest nie do odróżnienia od nieistniejącej — 404', async () => {
      businessFindUnique.mockResolvedValue({ logoVersion: null, coverVersion: 'inny' });
      await expect(service.findVersion('b1', BusinessImageKind.LOGO)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      businessFindUnique.mockResolvedValue(null);
      await expect(service.findVersion('b1', BusinessImageKind.LOGO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('zaciąga bajty dopiero osobnym zapytaniem', async () => {
      imageFindUnique.mockResolvedValue({
        mime: 'image/webp',
        version: 'abc123',
        bytes: new Uint8Array([1, 2]),
      });
      const image = await service.findBytes('b1', BusinessImageKind.COVER);

      expect(imageFindUnique).toHaveBeenCalledWith({
        where: { businessId_kind: { businessId: 'b1', kind: BusinessImageKind.COVER } },
        select: { mime: true, version: true, bytes: true },
      });
      // wersja jedzie razem z bajtami — ETag odpowiedzi opisuje to, co w niej jest
      expect(image).toMatchObject({ mime: 'image/webp', version: 'abc123' });
    });

    it('brak wiersza z bajtami to 404', async () => {
      imageFindUnique.mockResolvedValue(null);
      await expect(service.findBytes('b1', BusinessImageKind.LOGO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
