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
 * Czy odwołanie mieści się w oknie z polityki firmy. SDD §7 ogranicza czasowo wyłącznie
 * `CONFIRMED` — `PENDING` klient odwołuje zawsze, więc dla niego okno jest z definicji
 * spełnione (firma jeszcze nic nie potwierdziła, nie ma czego rekompensować).
 *
 * Wydzielone z `canClientCancel`, bo od #52 to dwie różne informacje: „wolno odwołać" (na to
 * wpływa też opłacona zaliczka) i „w terminie" (od tego zależy zwrot pieniędzy). Zlanie ich
 * w jedno dawało zwrot przy każdym odwołaniu opłaconej rezerwacji, również po terminie.
 */
export const isWithinCancellationWindow = (
  status: BookingStatus,
  startsAt: Date,
  cancellationHours: number,
  now: Date,
): boolean =>
  status === BookingStatus.PENDING ||
  now < cancellationDeadline(startsAt, cancellationHours);

/**
 * SDD §7: klient odwołuje `PENDING` zawsze, `CONFIRMED` tylko gdy
 * `now < startsAt − cancellationHours`. Nierówność jest ostra, więc *dokładnie* X godzin
 * przed startem odwołanie już nie przechodzi — granica należy do firmy, nie do klienta.
 *
 * `now` wchodzi argumentem zamiast `new Date()` w środku: test sprawdza granicę bez fake
 * timerów, a #28 policzy flagę dla całej listy na jednym, spójnym znaczniku czasu.
 *
 * `hasPaidDeposit` znosi limit czasowy (#52): opłacona zaliczka jest sama w sobie rekompensatą
 * za nieobsadzony termin, więc po terminie odwołanie przechodzi, a zaliczka przepada
 * (`depositOutcome` w refund-policy.ts). Bez zaliczki firma nie ma z czego pokryć pustego
 * okienka i zostaje przy dotychczasowym 409. Parametr jest **wymagany**, bez wartości
 * domyślnej: liczą z tej funkcji dwa miejsca — `transition()` i flaga `canCancel` z #28 —
 * i cicho rozjechana domyślka pokazałaby w UI przycisk, którego API nie przyjmie.
 *
 * Wyjątek na zaliczkę kończy się na `startsAt`: znosi limit **z polityki firmy**, a nie prawo
 * do odwołania wizyty, która już się zaczęła. Bez tej granicy klient mógłby zamienić odbytą
 * wizytę w „odwołaną przez klienta", dopóki cron auto-COMPLETED (#39) jej nie domknie —
 * firma miałaby w kalendarzu odwołanie zamiast wizyty, a rezerwacja nigdy nie doszłaby do
 * `COMPLETED`, więc przepadłaby też możliwość jej ocenienia (#47).
 */
export const canClientCancel = (
  status: BookingStatus,
  startsAt: Date,
  cancellationHours: number,
  now: Date,
  hasPaidDeposit: boolean,
): boolean => {
  // Które stany w ogóle da się odwołać, mówi maszyna stanów — stany terminalne odpadają
  // tutaj, bez drugiej listy do utrzymania.
  if (!canTransition(status, BookingStatus.CANCELLED_BY_CLIENT)) {
    return false;
  }
  if (isWithinCancellationWindow(status, startsAt, cancellationHours, now)) {
    return true;
  }
  return hasPaidDeposit && now < startsAt;
};

/**
 * Czy odwołanie **teraz** kosztuje klienta zaliczkę. Osobno od `canClientCancel`, bo to dwie
 * różne informacje dla frontu (#53): tam „czy przycisk jest aktywny", tu „czy przy kliknięciu
 * ostrzec, że pieniądze przepadną". Bez opłaconej zaliczki zawsze `false` — nie ma czego stracić.
 */
export const willForfeitDeposit = (
  status: BookingStatus,
  startsAt: Date,
  cancellationHours: number,
  now: Date,
  hasPaidDeposit: boolean,
): boolean =>
  hasPaidDeposit &&
  !isWithinCancellationWindow(status, startsAt, cancellationHours, now);

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
