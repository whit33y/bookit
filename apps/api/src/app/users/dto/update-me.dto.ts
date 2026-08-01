import { IsOptional, MaxLength, Matches } from 'class-validator';
import { NAME_MAX_LENGTH } from '../../auth/dto/auth.dto';
import { IsNotBlank } from '../../common/validators/is-not-blank';

// tylko pola profilu — email i rola celowo pominięte, globalny
// forbidNonWhitelisted odrzuci je jako 400
export class UpdateMeDto {
  // limity te same co przy rejestracji — inaczej dane wchodzące jedną drogą nie przeszłyby drugą
  @IsOptional()
  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  firstName?: string;

  @IsOptional()
  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  lastName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'Nieprawidłowy numer telefonu' })
  phone?: string;
}
