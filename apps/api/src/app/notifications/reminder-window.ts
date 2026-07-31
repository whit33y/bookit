import { addMinutes } from '../availability/business-time';

/**
 * Okno crona przypomnień (#38, SDD §7) — czysta funkcja, bez Nesta i Prismy, tak jak
 * cancellation-policy.ts w bookings. `now` wchodzi argumentem, więc test sprawdza granice
 * bez fake timerów i bez czekania (AC #38).
 */

const MINUTES_PER_HOUR = 60;

/** Ile przed wizytą leci przypomnienie — „~24 h przed" z SDD §7. */
export const REMINDER_LEAD_MIN = 24 * MINUTES_PER_HOUR;

/**
 * Krok crona. Wyznacza górną granicę okna (`lead + tick`), żeby wizyty potwierdzone na czas
 * dostawały maila dokładnie w swoim ticku, ~24 h przed terminem.
 */
export const REMINDER_TICK_MIN = 15;

/**
 * Dolny próg: bliżej niż 2 h przed wizytą przypomnienia już nie wysyłamy. Bez progu
 * nadganianie (patrz niżej) potrafiłoby wysłać „przypomnienie" kwadrans przed terminem,
 * co dla klienta jest bezużyteczne, a wygląda na awarię.
 */
export const REMINDER_FLOOR_MIN = 2 * MINUTES_PER_HOUR;

/** Przedział półotwarty `[from, to)` na `startsAt`. */
export interface ReminderWindow {
  from: Date;
  to: Date;
}

/**
 * Wizyty, którym na moment `now` należy się przypomnienie: `startsAt` od 2 h (włącznie)
 * do 24 h 15 min (wyłącznie) w przyszłość.
 *
 * Okno jest **nadganiające** — dolna granica to próg, nie `lead`. Wąskie okno 24–24,25 h
 * (litera AC) trafia rezerwację tylko raz w życiu i gubi dwa realne przypadki: rezerwację
 * potwierdzoną przez firmę już po tym ticku (`PENDING` → `CONFIRMED` jest ręczne, więc bywa
 * późne) oraz każdy tick pominięty przez restart czy deploy. W obu przypadkach żaden kolejny
 * tick by do niej nie wrócił i mail nie poleciałby nigdy. Przy szerokim oknie za „dokładnie
 * raz" odpowiada `reminderSentAt` (warunek w UPDATE), a nie geometria przedziału.
 *
 * Efekt uboczny, świadomy: po dłuższej przerwie w działaniu API przypomnienie może wyjść
 * np. 5 h przed wizytą, nie 24 h. Dlatego treść maila podaje konkretny termin, a nie „jutro".
 */
export const reminderWindow = (now: Date): ReminderWindow => ({
  from: addMinutes(now, REMINDER_FLOOR_MIN),
  to: addMinutes(now, REMINDER_LEAD_MIN + REMINDER_TICK_MIN),
});
