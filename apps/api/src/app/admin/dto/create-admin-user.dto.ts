import {
  IsEmail,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
  IsString,
} from 'class-validator';
import { NAME_MAX_LENGTH } from '../../auth/dto/auth.dto';
import { IsNotBlank } from '../../common/validators/is-not-blank';

/**
 * Konto administratora zakładane przez administratora (#144). Bez pola `role`: formularz
 * tworzy wyłącznie ADMIN-ów, bo każda inna rola ma już swoją drogę (klient rejestruje się
 * sam, właściciel powstaje z akceptacji zgłoszenia, pracownik z panelu firmy), a select
 * roli byłby drugą, sprzeczną.
 *
 * Limity dokładnie jak w RegisterDto — konto założone tędy ma przejść tę samą walidację
 * co konto założone samodzielnie.
 */
export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  firstName!: string;

  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  lastName!: string;

  // wzorzec jak w UpdateMeDto — telefon wchodzi tą samą bramką, którą później się go edytuje
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'Nieprawidłowy numer telefonu' })
  phone?: string;
}
