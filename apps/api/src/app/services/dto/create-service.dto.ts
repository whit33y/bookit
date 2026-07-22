import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// businessId i isActive celowo poza DTO — ustala je serwer (businessId z tokena,
// isActive domyślnie true / dezaktywacja przez DELETE),
// globalny forbidNonWhitelisted odrzuci je jako 400
export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // czas trwania w minutach — musi być dodatni (AC #16)
  @IsInt()
  @Min(1)
  durationMin!: number;

  // cena informacyjna w groszach — nieujemna (AC #16)
  @IsInt()
  @Min(0)
  priceCents!: number;
}
