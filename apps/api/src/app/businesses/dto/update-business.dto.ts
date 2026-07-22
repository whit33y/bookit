import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// edycja profilu — wszystkie pola opcjonalne (partial update).
// slug, ownerId, isBlocked, categoryId celowo poza DTO: slug niezmienny (MVP),
// resztę ustala serwer/token, a zmiana kategorii jest poza zakresem.
// Globalny forbidNonWhitelisted odrzuci te pola jako 400.
export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'Nieprawidłowy numer telefonu' })
  phone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  street?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;

  @IsOptional()
  @Matches(/^\d{2}-\d{3}$/, { message: 'Nieprawidłowy kod pocztowy' })
  postalCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cancellationHours?: number;
}
