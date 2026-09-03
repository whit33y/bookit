import { describe, expect, it } from 'vitest';
import { AdminController } from '../../admin/admin.controller';
import { AuthController } from '../../auth/auth.controller';
import { UsersController } from '../../users/users.controller';
import { PASSWORD_CHANGE_ALLOWED_KEY } from '../decorators/password-change.decorator';

// Strażnik z jwt-auth.guard.spec sprawdza samą regułę; tutaj pilnujemy listy wyjątków (#144).
// Bez tego usunięcie dekoratora z kontrolera zostawiłoby zielony pakiet testów i zamknęłoby
// nowego administratora w koncie, z którego nie ma wyjścia.
const allowed = (controller: object, method: string) =>
  Reflect.getMetadata(PASSWORD_CHANGE_ALLOWED_KEY, controller.constructor.prototype[method]) ??
  false;

describe('trasy dozwolone podczas wymuszonej zmiany hasła (#144)', () => {
  it('POST /auth/change-password jest otwarte — to jedyne wyjście z flagi', () => {
    expect(allowed(AuthController.prototype, 'changePassword')).toBe(true);
  });

  it('GET /users/me jest otwarte, PATCH /users/me już nie', () => {
    expect(allowed(UsersController.prototype, 'getMe')).toBe(true);
    expect(allowed(UsersController.prototype, 'patchMe')).toBe(false);
  });

  it('reszta panelu administratora zostaje zamknięta', () => {
    expect(allowed(AdminController.prototype, 'listUsers')).toBe(false);
    expect(allowed(AdminController.prototype, 'createUser')).toBe(false);
  });
});
