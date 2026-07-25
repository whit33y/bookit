import { IsOptional, IsUUID, Matches } from 'class-validator';

// query dla publicznego GET /businesses/:slug/availability
export class AvailabilityQueryDto {
  @IsUUID('all')
  serviceId!: string;

  // brak → sloty wszystkich aktywnych pracowników wykonujących usługę
  @IsOptional()
  @IsUUID('all')
  employeeId?: string;

  // data lokalna firmy (Europe/Warsaw), nie instant — dzień, dla którego liczymy sloty.
  // Regex pilnuje kształtu; istnienie daty w kalendarzu sprawdza parseLocalDate w serwisie.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date musi mieć format YYYY-MM-DD' })
  date!: string;
}
