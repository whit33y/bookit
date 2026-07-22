import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

// zapis pełnej listy pracowników wykonujących usługę (semantyka replace).
// Pusta tablica dozwolona — czyści przypisania. Nadmiarowe pola odrzuci
// globalny forbidNonWhitelisted → 400.
export class SetServiceEmployeesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  employeeIds!: string[];
}
