import type { CalendarBooking } from './calendar/booking-details-dialog';

/** Zakres, którego `GET /businesses/mine/bookings` (#31) wymaga zawsze — daty kalendarzowe
 *  strefy firmy („YYYY-MM-DD"), nie instanty. Osobny typ, bo `from`/`to` wędrują razem przez
 *  cały panel: liczy je `pendingRange()`, `agendaRange()` i `rangeForView()`. */
export interface BookingRange {
  from: string;
  to: string;
}

/** Adres rezerwacji firmy dla danego zakresu. Endpoint nie ma filtra po statusie, więc każdy
 *  ekran bierze okno dat i odsiewa resztę u siebie — jedno miejsce na składanie tego adresu
 *  wystarczy na wszystkie. */
export function mineBookingsUrl({ from, to }: BookingRange): string {
  return `/businesses/mine/bookings?${new URLSearchParams({ from, to })}`;
}

/** Porządek naturalny rezerwacji: rosnąco po terminie. API nie obiecuje kolejności. */
export function byStartsAt(a: CalendarBooking, b: CalendarBooking): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}
