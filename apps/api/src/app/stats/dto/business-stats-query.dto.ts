import { Matches } from 'class-validator';

// query dla GET /businesses/mine/stats. from/to to lokalne daty firmy (Europe/Warsaw),
// nie instanty — jak w BusinessBookingsQueryDto (#31). Kształt sprawdza regex, istnienie
// w kalendarzu, kolejność i długość zakresu rozstrzyga serwis.
export class BusinessStatsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from musi mieć format YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to musi mieć format YYYY-MM-DD' })
  to!: string;
}
