import { BookingStatus } from '@prisma/client';
import { addMinutes } from '../availability/business-time';
import { canTransition } from './booking-status';

const MINUTES_PER_HOUR = 60;

/**
 * Polityka odwołań klienta z SDD §7 — czysta, bez PrismaService i bez Nesta, tak jak
 * booking-status.ts obok. #28 (`GET /bookings/mine`) ma zwracać per rezerwacja flagę
 * „czy odwołanie jest jeszcze możliwe (front nie liczy tego sam)" i policzy ją tą samą
 * funkcją, zamiast powtarzać regułę u siebie.
 */

// Ostatni moment, w którym klient może jeszcze odwołać CONFIRMED.
export const cancellationDeadline = (startsAt: Date, cancellationHours: number): Date =>
  addMinutes(startsAt, -cancellationHours * MINUTES_PER_HOUR);

/**
 * SDD §7: klient odwołuje `PENDING` zawsze, `CONFIRMED` tylko gdy
 * `now < startsAt − cancellationHours`. Nierówność jest ostra, więc *dokładnie* X godzin
 * przed startem odwołanie już nie przechodzi — granica należy do firmy, nie do klienta.
 *
 * `now` wchodzi argumentem zamiast `new Date()` w środku: test sprawdza granicę bez fake
 * timerów, a #28 policzy flagę dla całej listy na jednym, spójnym znaczniku czasu.
 */
export const canClientCancel = (
  status: BookingStatus,
  startsAt: Date,
  cancellationHours: number,
  now: Date,
): boolean => {
  // Które stany w ogóle da się odwołać, mówi maszyna stanów — stany terminalne odpadają
  // tutaj, bez drugiej listy do utrzymania.
  if (!canTransition(status, BookingStatus.CANCELLED_BY_CLIENT)) {
    return false;
  }
  if (status === BookingStatus.PENDING) {
    return true;
  }
  return now < cancellationDeadline(startsAt, cancellationHours);
};

// Odmiana liczebnika, żeby komunikat nie brzmiał „24 godzin przed wizytą".
const hoursLabel = (hours: number): string => {
  if (hours === 1) {
    return 'godzinę';
  }
  const lastTwo = hours % 100;
  const last = hours % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return 'godziny';
  }
  return 'godzin';
};

// Komunikat 409 przy naruszeniu polityki — AC #27 wymaga, żeby mówił o limicie godzin.
export const cancellationWindowMessage = (cancellationHours: number): string =>
  `Rezerwację można odwołać najpóźniej ${cancellationHours} ${hoursLabel(cancellationHours)} przed wizytą`;
