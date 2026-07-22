import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// edycja pracownika — wszystkie pola opcjonalne (partial update).
// isActive dozwolone, by panel mógł reaktywować dezaktywowanego pracownika (#22).
// email pozwala powiązać konto już po utworzeniu. Globalny forbidNonWhitelisted
// odrzuci pozostałe pola jako 400.
export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEmail()
  email?: string;
}
