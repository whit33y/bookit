import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// tylko pola profilu — email i rola celowo pominięte, globalny
// forbidNonWhitelisted odrzuci je jako 400
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'Nieprawidłowy numer telefonu' })
  phone?: string;
}
