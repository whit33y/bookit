import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const me = { sub: 'user-1' } as AuthUser;

const dto = {
  newEmail: 'nowy@example.com',
  newEmailConfirm: 'nowy@example.com',
  currentPassword: 'poprawne-haslo',
};

describe('UsersController — zmiana adresu e-mail (#167)', () => {
  it('deleguje do serwisu z id zalogowanego', async () => {
    const changeEmail = vi.fn().mockResolvedValue({ id: 'user-1' });
    const controller = new UsersController({ changeEmail } as unknown as UsersService);

    await controller.patchMyEmail(me, dto);

    expect(changeEmail).toHaveBeenCalledWith('user-1', dto);
  });

  // Reguła „EMPLOYEE i ADMIN dostają 403" siedzi w metadanych guarda, nie w ciele metody —
  // bez tego sprawdzenia usunięcie dekoratora zostawiłoby zielony pakiet testów, a konto
  // nadane przez organizację dałoby się przepisać na własny adres.
  it('trasa jest otwarta wyłącznie dla CLIENT-a i OWNER-a', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.patchMyEmail)).toEqual([
      UserRole.CLIENT,
      UserRole.OWNER,
    ]);
  });

  it('trasa jest pod throttlerem — currentPassword jest polem do zgadywania', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, UsersController.prototype.patchMyEmail),
    ).toContain(ThrottlerGuard);
  });
});
