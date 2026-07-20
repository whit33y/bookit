import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// slug, ownerId i isBlocked celowo poza DTO — ustala je serwer,
// globalny forbidNonWhitelisted odrzuci je jako 400
export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'Nieprawidłowy numer telefonu' })
  phone?: string;

  @IsString()
  @IsNotEmpty()
  street!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsOptional()
  @Matches(/^\d{2}-\d{3}$/, { message: 'Nieprawidłowy kod pocztowy' })
  postalCode?: string;

  // współrzędne z geokodowania na froncie; @IsNumber zamiast @IsLatitude,
  // bo ten drugi przepuszcza stringi, a pipe nie ma transform → Prisma dostaje
  // string i wywala 500
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  // brak wartości → default 24 ze schematu Prismy
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cancellationHours?: number;
}
