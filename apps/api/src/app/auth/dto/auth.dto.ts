import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNotBlank } from '../../common/validators/is-not-blank';

/** Limit imienia i nazwiska — kolumny w Prismie są bez granicy, więc DTO jest jedyną. */
export const NAME_MAX_LENGTH = 50;

export class RegisterDto {
  @IsEmail()
  email!: string;

  // bcrypt liczy tylko pierwsze 72 bajty — odcinamy dłuższe hasła na wejściu
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
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
