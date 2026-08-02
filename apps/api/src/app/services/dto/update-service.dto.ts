import { DepositType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsNotBlank } from '../../common/validators/is-not-blank';

// edycja usługi — wszystkie pola opcjonalne (partial update).
// businessId celowo poza DTO (usługi nie przenosi się między firmami);
// isActive dozwolone, by panel mógł reaktywować dezaktywowaną usługę (#21).
// Globalny forbidNonWhitelisted odrzuci pozostałe pola jako 400.
export class UpdateServiceDto {
  @IsOptional()
  @IsNotBlank()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // górne limity jak w CreateServiceDto — chronią kolumnę Int przed przepełnieniem
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Zaliczka (#50) — @IsOptional() przepuszcza null, i tak ma być: żeby wyłączyć zaliczkę,
  // panel wysyła oba pola jako null. Serwis waliduje stan po scaleniu z wierszem z bazy,
  // więc odróżnia „pole nieprzesłane" od jawnego null.
  @IsOptional()
  @IsEnum(DepositType)
  depositType?: DepositType | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  depositValue?: number | null;
}
