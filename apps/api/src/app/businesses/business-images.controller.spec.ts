import { HttpStatus, StreamableFile } from '@nestjs/common';
import { BusinessImageKind, UserRole } from '@prisma/client';
import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { BusinessImagesController } from './business-images.controller';
import { BusinessImagesService } from './business-images.service';

const owner = { sub: 'u1' } as AuthUser;

const etagOf = (res: { setHeader: ReturnType<typeof vi.fn> }) =>
  res.setHeader.mock.calls.find(([name]) => name === 'ETag')?.[1];

describe('BusinessImagesController (#153)', () => {
  let findVersion: ReturnType<typeof vi.fn>;
  let findBytes: ReturnType<typeof vi.fn>;
  let replaceMine: ReturnType<typeof vi.fn>;
  let removeMine: ReturnType<typeof vi.fn>;
  let controller: BusinessImagesController;
  let res: Response & { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    findVersion = vi.fn().mockResolvedValue('abc123');
    findBytes = vi.fn().mockResolvedValue({
      mime: 'image/webp',
      version: 'abc123',
      bytes: new Uint8Array([1, 2, 3]),
    });
    replaceMine = vi.fn().mockResolvedValue({ version: 'abc123' });
    removeMine = vi.fn().mockResolvedValue(undefined);
    controller = new BusinessImagesController({
      findVersion,
      findBytes,
      replaceMine,
      removeMine,
    } as unknown as BusinessImagesService);
    res = { setHeader: vi.fn(), status: vi.fn() } as unknown as typeof res;
  });

  it('odpowiedź na wgranie nazywa slot tak jak URL', async () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    await expect(controller.replace(owner, BusinessImageKind.COVER, file)).resolves.toEqual({
      kind: 'cover',
      version: 'abc123',
    });
    expect(replaceMine).toHaveBeenCalledWith('u1', BusinessImageKind.COVER, file);
  });

  it('publiczny GET oddaje bajty z ETagiem wersji', async () => {
    const result = await controller.serve('b1', BusinessImageKind.LOGO, undefined, res);

    expect(etagOf(res)).toBe('"abc123"');
    expect(result).toBeInstanceOf(StreamableFile);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('powtórne żądanie z If-None-Match kończy się 304 bez sięgania po bajty', async () => {
    const result = await controller.serve('b1', BusinessImageKind.LOGO, '"abc123"', res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(etagOf(res)).toBe('"abc123"');
    expect(result).toBeUndefined();
    expect(findBytes).not.toHaveBeenCalled();
  });

  it('nieaktualny ETag dostaje pełną odpowiedź', async () => {
    await controller.serve('b1', BusinessImageKind.LOGO, '"stary"', res);
    expect(findBytes).toHaveBeenCalledWith('b1', BusinessImageKind.LOGO);
  });

  // Regresja: wersja szła z Business, bajty z BusinessImage — równoległe wgranie między tymi
  // zapytaniami wystawiało stare bajty pod nowym ETagiem, a `immutable` utrwalało to na rok.
  it('ETag opisuje wysłane bajty, nawet gdy wskaźnik na Business zdążył się zmienić', async () => {
    findVersion.mockResolvedValue('nowa');
    findBytes.mockResolvedValue({
      mime: 'image/webp',
      version: 'stara',
      bytes: new Uint8Array([9]),
    });

    await controller.serve('b1', BusinessImageKind.LOGO, undefined, res);

    expect(etagOf(res)).toBe('"stara"');
  });

  // Reguła „nie-OWNER dostaje 403" siedzi w metadanych guarda, nie w ciele metody — bez tego
  // sprawdzenia usunięcie dekoratora zostawiłoby zielony pakiet testów i otwarte trasy.
  it('trasy zmieniające obraz są zamknięte dla wszystkich poza OWNER-em', () => {
    for (const method of ['replace', 'remove'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, BusinessImagesController.prototype[method])).toEqual([
        UserRole.OWNER,
      ]);
    }
  });

  it('publiczny odczyt nie wymaga żadnej roli', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, BusinessImagesController.prototype.serve),
    ).toBeUndefined();
  });
});
