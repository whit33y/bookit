import { IsOptional, IsUUID, Matches } from 'class-validator';

// query dla GET /businesses/mine/bookings. from/to to lokalne daty firmy (Europe/Warsaw),
// nie instanty — jak date w AvailabilityQueryDto. Kształt sprawdza regex, istnienie
// w kalendarzu i konwersję na UTC robi parseLocalDate/localDayRangeUtc w serwisie.
export class BusinessBookingsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from musi mieć format YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to musi mieć format YYYY-MM-DD' })
  to!: string;

  // tylko dla OWNER — EMPLOYEE ma filtr wymuszony serwerowo na własnym employeeId
  @IsOptional()
  @IsUUID('all')
  employeeId?: string;
}
