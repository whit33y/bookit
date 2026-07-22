import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// edycja usługi — wszystkie pola opcjonalne (partial update).
// businessId celowo poza DTO (usługi nie przenosi się między firmami);
// isActive dozwolone, by panel mógł reaktywować dezaktywowaną usługę (#21).
// Globalny forbidNonWhitelisted odrzuci pozostałe pola jako 400.
export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
}
