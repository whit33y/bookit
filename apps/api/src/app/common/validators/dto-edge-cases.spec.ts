import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAdminUserDto } from '../../admin/dto/create-admin-user.dto';
import {
  ChangePasswordDto,
  NAME_MAX_LENGTH,
  RegisterDto,
} from '../../auth/dto/auth.dto';
import {
  CITY_MAX_LENGTH,
  CreateBusinessDto,
  STREET_MAX_LENGTH,
} from '../../businesses/dto/create-business.dto';
import { CreateServiceDto } from '../../services/dto/create-service.dto';

/** Klucze ograniczeń, które odrzuciły dane pole — dokładnie to, co trafia do `fields`
 *  w kopercie błędu (#45). */
async function failedFields(dtoClass: new () => object, payload: object) {
  const errors = await validate(plainToInstance(dtoClass, payload));
  return Object.fromEntries(
    errors.map((e) => [e.property, Object.keys(e.constraints ?? {})]),
  );
}

const validRegister = {
  email: 'anna@example.com',
  password: 'tajneHaslo1',
  firstName: 'Anna',
  lastName: 'Nowak',
};

const validBusiness = {
  name: 'Salon Anna',
  categoryId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  street: 'Kwiatowa 5',
  city: 'Kraków',
  lat: 50.06,
  lng: 19.94,
};

describe('walidacja DTO — przypadki brzegowe (#45)', () => {
  it('poprawne dane rejestracji przechodzą', async () => {
    await expect(failedFields(RegisterDto, validRegister)).resolves.toEqual({});
  });

  it('imię i nazwisko z samych spacji jest odrzucone', async () => {
    const fields = await failedFields(RegisterDto, {
      ...validRegister,
      firstName: '   ',
      lastName: '\t',
    });

    expect(fields).toEqual({
      firstName: ['isNotBlank'],
      lastName: ['isNotBlank'],
    });
  });

  it('imię ma górny limit długości', async () => {
    const fields = await failedFields(RegisterDto, {
      ...validRegister,
      firstName: 'a'.repeat(NAME_MAX_LENGTH + 1),
    });

    expect(fields.firstName).toContain('maxLength');
  });

  it('adres firmy ma górne limity — kolumny w Prismie są bez granicy', async () => {
    const fields = await failedFields(CreateBusinessDto, {
      ...validBusiness,
      street: 'a'.repeat(STREET_MAX_LENGTH + 1),
      city: 'b'.repeat(CITY_MAX_LENGTH + 1),
    });

    expect(fields.street).toContain('maxLength');
    expect(fields.city).toContain('maxLength');
  });

  it('nazwa firmy i miasto z samych spacji są odrzucone', async () => {
    const fields = await failedFields(CreateBusinessDto, {
      ...validBusiness,
      name: '  ',
      city: ' ',
    });

    expect(fields.name).toEqual(['isNotBlank']);
    expect(fields.city).toEqual(['isNotBlank']);
  });

  it('nazwa usługi z samych spacji jest odrzucona, a otoczona spacjami przechodzi', async () => {
    await expect(
      failedFields(CreateServiceDto, {
        name: '   ',
        durationMin: 30,
        priceCents: 8000,
      }),
    ).resolves.toEqual({ name: ['isNotBlank'] });

    await expect(
      failedFields(CreateServiceDto, {
        name: ' Strzyżenie ',
        durationMin: 30,
        priceCents: 8000,
      }),
    ).resolves.toEqual({});
  });

  describe('konto administratora i zmiana hasła (#144)', () => {
    const validAdmin = {
      email: 'admin@bookit.pl',
      password: 'startowe-haslo1',
      firstName: 'Ola',
      lastName: 'Nowak',
    };

    it('poprawne dane przechodzą, telefon jest opcjonalny', async () => {
      await expect(failedFields(CreateAdminUserDto, validAdmin)).resolves.toEqual({});
      await expect(
        failedFields(CreateAdminUserDto, { ...validAdmin, phone: '+48 600 700 800' }),
      ).resolves.toEqual({});
    });

    it('hasło ma te same granice co przy rejestracji', async () => {
      const short = { ...validAdmin, password: 'krotkie' };
      expect(await failedFields(CreateAdminUserDto, short)).toEqual(
        await failedFields(RegisterDto, { ...validRegister, password: 'krotkie' }),
      );

      // bcrypt liczy tylko 72 bajty — dłuższe hasło odpada na wejściu, jak w RegisterDto
      const long = { ...validAdmin, password: 'a'.repeat(73) };
      expect(await failedFields(CreateAdminUserDto, long)).toEqual({
        password: ['maxLength'],
      });
    });

    it('zmiana hasła wymaga obecnego hasła i nowego o długości jak przy rejestracji', async () => {
      expect(
        await failedFields(ChangePasswordDto, { currentPassword: '', newPassword: 'krotkie' }),
      ).toEqual({
        currentPassword: ['isNotEmpty'],
        newPassword: ['minLength'],
      });
    });
  });
});
