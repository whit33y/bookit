import { IsBoolean, IsEmail, IsOptional, MaxLength } from 'class-validator';
import { IsNotBlank } from '../../common/validators/is-not-blank';

// edycja pracownika — wszystkie pola opcjonalne (partial update).
// isActive dozwolone, by panel mógł reaktywować dezaktywowanego pracownika (#22).
// email pozwala powiązać konto już po utworzeniu. Globalny forbidNonWhitelisted
// odrzuci pozostałe pola jako 400.
export class UpdateEmployeeDto {
  @IsOptional()
  @IsNotBlank()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEmail()
  email?: string;
}
