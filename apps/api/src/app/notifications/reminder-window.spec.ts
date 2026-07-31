import { describe, expect, it } from 'vitest';
import {
  REMINDER_FLOOR_MIN,
  REMINDER_LEAD_MIN,
  REMINDER_TICK_MIN,
  reminderWindow,
} from './reminder-window';

// AC #38: „test logiki wyznaczania okna (bez realnego czekania — czas wstrzykiwany)".
// Żadnych fake timerów: reminderWindow bierze `now` argumentem.
const NOW = new Date('2026-01-13T12:00:00.000Z');
const MS_PER_MIN = 60_000;

const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * MS_PER_MIN);
const contains = (startsAt: Date) => {
  const { from, to } = reminderWindow(NOW);
  return startsAt >= from && startsAt < to;
};

describe('reminderWindow', () => {
  it('górna granica to 24 h 15 min od teraz — tick trafia wizytę ~24 h przed terminem', () => {
    expect(reminderWindow(NOW).to).toEqual(new Date('2026-01-14T12:15:00.000Z'));
  });

  it('dolna granica to próg 2 h, nie wyprzedzenie 24 h', () => {
    expect(reminderWindow(NOW).from).toEqual(new Date('2026-01-13T14:00:00.000Z'));
  });

  it('wizyta dokładnie 24 h przed startem jest w oknie', () => {
    expect(contains(at(REMINDER_LEAD_MIN))).toBe(true);
  });

  it('górna granica jest wyłączna — wizyta 24 h 15 min przed startem czeka na kolejny tick', () => {
    expect(contains(at(REMINDER_LEAD_MIN + REMINDER_TICK_MIN))).toBe(false);
    expect(contains(at(REMINDER_LEAD_MIN + REMINDER_TICK_MIN - 1))).toBe(true);
  });

  // Sedno wariantu nadganiającego: rezerwacja potwierdzona przez firmę po swoim „własnym"
  // ticku (PENDING → CONFIRMED jest ręczne) nadal łapie się do okna, zamiast przepaść.
  it('nadgania wizytę potwierdzoną późno — 20 h przed startem wciąż w oknie', () => {
    expect(contains(at(20 * 60))).toBe(true);
  });

  it('nadgania też pominięty tick — wizyta 23 h 50 min przed startem w oknie', () => {
    expect(contains(at(23 * 60 + 50))).toBe(true);
  });

  it('próg odcina wizyty tuż przed terminem', () => {
    expect(contains(at(30))).toBe(false);
    // granica progu należy do okna (`gte`)
    expect(contains(at(REMINDER_FLOOR_MIN))).toBe(true);
    expect(contains(at(REMINDER_FLOOR_MIN - 1))).toBe(false);
  });

  it('wizyta w przeszłości nie jest w oknie', () => {
    expect(contains(at(-60))).toBe(false);
  });

  it('okno przesuwa się razem z now', () => {
    const later = reminderWindow(new Date(NOW.getTime() + 5 * MS_PER_MIN));

    expect(later.from.getTime() - reminderWindow(NOW).from.getTime()).toBe(5 * MS_PER_MIN);
    expect(later.to.getTime() - reminderWindow(NOW).to.getTime()).toBe(5 * MS_PER_MIN);
  });

  // Stałe pilnują treści AC („okno 24–24,25 h" jako moment nominalny): zmiana którejkolwiek
  // to zmiana kontraktu z crona, nie detal implementacji.
  it('wyprzedzenie, krok i próg zgadzają się z ustaleniami', () => {
    expect(REMINDER_LEAD_MIN).toBe(24 * 60);
    expect(REMINDER_TICK_MIN).toBe(15);
    expect(REMINDER_FLOOR_MIN).toBe(2 * 60);
  });
});
