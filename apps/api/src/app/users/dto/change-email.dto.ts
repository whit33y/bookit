import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Zmiana adresu e-mail konta (#167). Adres jest loginem, więc formularz pyta o niego dwa razy
 * i o obecne hasło — zmiana wchodzi natychmiast, bez linku potwierdzającego (ADR-0003).
 *
 * Zgodność `newEmail` z `newEmailConfirm` sprawdza serwis, nie DTO: porównanie ma sens dopiero
 * po normalizacji, a tę robi serwis tą samą funkcją co rejestracja.
 */
export class ChangeEmailDto {
  @IsEmail()
  newEmail!: string;

  @IsEmail()
  newEmailConfirm!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
