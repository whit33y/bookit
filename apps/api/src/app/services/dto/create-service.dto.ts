import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsNotBlank } from '../../common/validators/is-not-blank';

// businessId i isActive celowo poza DTO — ustala je serwer (businessId z tokena,
// isActive domyślnie true / dezaktywacja przez DELETE),
// globalny forbidNonWhitelisted odrzuci je jako 400
export class CreateServiceDto {
  @IsNotBlank()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // czas trwania w minutach — dodatni, max doba; górny limit chroni przed
  // przepełnieniem kolumny Int (Int4) → 400 zamiast 500 (AC #16)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMin!: number;

  // cena informacyjna w groszach — nieujemna, max 1 mln zł; górny limit jw. (AC #16)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents!: number;
}
