import { IsOptional, IsUUID, Matches } from 'class-validator';

// query dla publicznego GET /businesses/:slug/availability/first-slots
export class FirstSlotsQueryDto {
  @IsUUID('all')
  serviceId!: string;

  // brak → pierwszy wolny termin liczony ze wszystkich aktywnych pracowników wykonujących usługę
  @IsOptional()
  @IsUUID('all')
  employeeId?: string;

  // Granice zakresu jako daty lokalne firmy (Europe/Warsaw), obie włącznie. Regex pilnuje
  // kształtu; istnienie daty w kalendarzu, porządek granic i długość zakresu sprawdza serwis
  // — to reguły domeny, a nie kształtu żądania.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from musi mieć format YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to musi mieć format YYYY-MM-DD' })
  to!: string;
}
