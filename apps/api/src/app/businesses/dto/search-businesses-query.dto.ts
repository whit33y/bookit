import { IsNotEmpty, IsNumberString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Query params przychodzą jako stringi, a globalny ValidationPipe nie ma `transform: true`
// (patrz komentarz w create-business.dto.ts) — jak w BusinessBookingsQueryDto walidujemy
// tu tylko kształt; parsowanie na liczby i walidację zakresów (lat/lng/radiusKm/page/limit)
// robi serwis.
export class SearchBusinessesQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsNumberString()
  lat?: string;

  @IsOptional()
  @IsNumberString()
  lng?: string;

  @IsOptional()
  @IsNumberString()
  radiusKm?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;
}
