import { todayInBusinessTz } from '../../shared/business-time';
import type {
  BookingStatus,
  CalendarBooking,
} from '../calendar/booking-details-dialog';
import { addDays } from '../calendar/calendar-date';
import { byStartsAt, type BookingRange } from '../mine-bookings';

/** Ile pozycji mieści agenda kafelka kalendarza (#133: „3 najbliższe wizyty"). */
export const AGENDA_LIMIT = 3;

/** Jak daleko w przód patrzy kafelek. Agenda ma pokazać, co dalej — także jutro, gdy dziś
 *  nic już nie zostało — więc okno musi sięgać poza dzisiaj, ale zostaje krótkie: to podgląd
 *  najbliższych wizyt, nie kalendarz. Dalsze terminy są na `/business/calendar`, a stan pusty
 *  mówi wprost „brak wizyt w najbliższych dniach", nie „brak wizyt". */
const AGENDA_LOOKAHEAD_DAYS = 7;

/** Statusy nadchodzącej wizyty wg CONTEXT.md — te i tylko te trafiają do agendy. Odrzucone,
 *  odwołane i zakończone nie są „tym, co dalej", a `GET /businesses/mine/bookings` (#31)
 *  nie ma filtra po statusie, więc odsiewamy je po stronie klienta. */
export type AgendaStatus = Extract<BookingStatus, 'CONFIRMED' | 'PENDING'>;

/** Wizyta, która przeszła filtr statusów — węższy `status` niesie się dalej do widoku,
 *  dzięki czemu mapa kropek nie potrzebuje rzutowania. */
export type AgendaBooking = CalendarBooking & { status: AgendaStatus };

const isAgendaBooking = (booking: CalendarBooking): booking is AgendaBooking =>
  booking.status === 'CONFIRMED' || booking.status === 'PENDING';

/** Zakres do `GET /businesses/mine/bookings` dla kafelka kalendarza. */
export function agendaRange(nowMs: number): BookingRange {
  const today = todayInBusinessTz(new Date(nowMs));
  return { from: today, to: addDays(today, AGENDA_LOOKAHEAD_DAYS) };
}

/**
 * Liczba dzisiejszych wizyt — cały dzień, także godziny, które już minęły. To kontekst dnia
 * w nagłówku kafelka („Dziś: 3 wizyty"), świadomie liczony inaczej niż lista pod nim: lista
 * mówi, co jeszcze przed firmą, nagłówek — ile dzień ma w sumie.
 *
 * „W sumie" wg tej samej definicji nadchodzącej wizyty co agenda (CONFIRMED i PENDING):
 * odwołana wizyta nie jest pracą dnia, a odbyta zmienia status na COMPLETED dopiero po
 * fakcie — dzień z samymi zakończonymi wizytami pokazuje więc „Dziś brak wizyt".
 */
export function todayVisitCount(
  bookings: readonly CalendarBooking[],
  nowMs: number,
): number {
  const today = todayInBusinessTz(new Date(nowMs));
  return bookings
    .filter(isAgendaBooking)
    .filter((b) => todayInBusinessTz(new Date(b.startsAt)) === today).length;
}

/**
 * Najbliższe wizyty licząc **od teraz**, nie od początku dnia — o 16:00 kafelek ma pokazywać
 * to, co jeszcze będzie, a nie poranek, który już minął. Odcięcie idzie po `startsAt`, więc
 * wizyta trwająca w tej chwili jest już za odcięciem.
 */
export function upcomingAgenda(
  bookings: readonly CalendarBooking[],
  nowMs: number,
): AgendaBooking[] {
  return bookings
    .filter(isAgendaBooking)
    .filter((b) => new Date(b.startsAt).getTime() >= nowMs)
    .sort(byStartsAt)
    .slice(0, AGENDA_LIMIT);
}
