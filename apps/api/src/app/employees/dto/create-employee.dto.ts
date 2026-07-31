import { IsEmail, IsOptional, MaxLength } from 'class-validator';
import { IsNotBlank } from '../../common/validators/is-not-blank';

// businessId/isActive/userId celowo poza DTO — ustala je serwer
// (businessId z tokena, userId z lookupu po email, isActive domyślnie true).
// Globalny forbidNonWhitelisted odrzuci je jako 400.
export class CreateEmployeeDto {
  @IsNotBlank()
  @MaxLength(100)
  name!: string;

  // opcjonalne powiązanie z kontem: e-mail istniejącego usera → rola EMPLOYEE.
  // Brak email → pracownik bez konta (userId null).
  @IsOptional()
  @IsEmail()
  email?: string;
}
