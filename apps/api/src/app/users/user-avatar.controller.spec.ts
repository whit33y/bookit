import { HttpStatus, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_CHANGE_ALLOWED_KEY } from '../common/decorators/password-change.decorator';
import { AuthUser } from '../common/types/auth-user';
import { UserAvatarController } from './user-avatar.controller';
import { UserAvatarService } from './user-avatar.service';

const signedIn = { sub: 'u1' } as AuthUser;

const etagOf = (res: { setHeader: ReturnType<typeof vi.fn> }) =>
  res.setHeader.mock.calls.find(([name]) => name === 'ETag')?.[1];

describe('UserAvatarController (#163)', () => {
  let findVersion: ReturnType<typeof vi.fn>;
  let findBytes: ReturnType<typeof vi.fn>;
  let replaceMine: ReturnType<typeof vi.fn>;
  let removeMine: ReturnType<typeof vi.fn>;
  let controller: UserAvatarController;
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
    controller = new UserAvatarController({
      findVersion,
      findBytes,
      replaceMine,
      removeMine,
    } as unknown as UserAvatarService);
    res = { setHeader: vi.fn(), status: vi.fn() } as unknown as typeof res;
  });

  // Właściciel zasobu bierze się z tokena — ścieżka zmieniających tras nie ma parametru,
  // więc nie ma czego podstawić.
  it('wgranie i usunięcie idą na konto z tokena, nie na parametr ścieżki', async () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    await expect(controller.replace(signedIn, file)).resolves.toEqual({ version: 'abc123' });
    expect(replaceMine).toHaveBeenCalledWith('u1', file);

    await controller.remove(signedIn);
    expect(removeMine).toHaveBeenCalledWith('u1');
  });

  it('publiczny GET oddaje bajty z ETagiem wersji', async () => {
    const result = await controller.serve('u1', undefined, res);

    expect(etagOf(res)).toBe('"abc123"');
    expect(result).toBeInstanceOf(StreamableFile);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('powtórne żądanie z If-None-Match kończy się 304 bez sięgania po bajty', async () => {
    const result = await controller.serve('u1', '"abc123"', res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(etagOf(res)).toBe('"abc123"');
    expect(result).toBeUndefined();
    expect(findBytes).not.toHaveBeenCalled();
  });

  it('nieaktualny ETag dostaje pełną odpowiedź', async () => {
    await controller.serve('u1', '"stary"', res);
    expect(findBytes).toHaveBeenCalledWith('u1');
  });

  // Regresja pilnowana już przy obrazach firm: wersja z User, bajty z UserImage — równoległe
  // wgranie między tymi zapytaniami wystawiłoby stare bajty pod nowym ETagiem, a `immutable`
  // utrwaliłoby to na rok.
  it('ETag opisuje wysłane bajty, nawet gdy wskaźnik na User zdążył się zmienić', async () => {
    findVersion.mockResolvedValue('nowa');
    findBytes.mockResolvedValue({
      mime: 'image/webp',
      version: 'stara',
      bytes: new Uint8Array([9]),
    });

    await controller.serve('u1', undefined, res);

    expect(etagOf(res)).toBe('"stara"');
  });

  // Zmiana zdjęcia to „cokolwiek innego" niż wyjście z wymuszonej zmiany hasła (#144) —
  // domyślne zamknięcie musi tu zostać.
  it('trasy zmieniające zdjęcie są zamknięte podczas wymuszonej zmiany hasła', () => {
    for (const method of ['replace', 'remove'] as const) {
      expect(
        Reflect.getMetadata(PASSWORD_CHANGE_ALLOWED_KEY, UserAvatarController.prototype[method]),
      ).toBeUndefined();
    }
  });
});
