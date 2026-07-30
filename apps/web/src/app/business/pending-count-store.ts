import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../core/api-client';
import { AuthStore } from '../core/auth/auth-store';
import { todayInBusinessTz } from '../shared/business-time';
import { addDays } from './calendar/calendar-date';

const LOOKBACK_DAYS = 60;
const LOOKAHEAD_DAYS = 180;

/** Zakres do GET /businesses/mine/bookings dla listy oczekujących (#33) — endpoint (#31) nie ma
 *  filtra po statusie i wymaga from/to, więc bierzemy szerokie okno wokół dziś i filtrujemy
 *  PENDING po stronie klienta. Wyeksportowane, żeby lista oczekujących używała dokładnie tego
 *  samego zakresu co licznik w nawigacji. */
export function pendingRange(): { from: string; to: string } {
  const today = todayInBusinessTz();
  return { from: addDays(today, -LOOKBACK_DAYS), to: addDays(today, LOOKAHEAD_DAYS) };
}

interface MinimalBooking {
  status: string;
}

/** Licznik oczekujących rezerwacji widoczny w nawigacji panelu firmy (#33, AC „licznik widoczny
 *  w nawigacji"). Osobny od stanu strony /business/pending — nawigacja żyje dłużej niż jedna
 *  podstrona, więc potrzebuje wspólnego źródła prawdy zamiast lokalnego sygnału komponentu. */
@Service()
export class PendingCountStore {
  private readonly api = inject(ApiClient);
  private readonly authStore = inject(AuthStore);

  private readonly countSignal = signal(0);
  readonly count = this.countSignal.asReadonly();

  private readonly canHaveBookings = computed(() => {
    const role = this.authStore.user()?.role;
    return role === 'OWNER' || role === 'EMPLOYEE';
  });

  // strażnik wyścigu: set()/decrement() reprezentują świeższy, autorytatywny stan (wynik
  // udanej akcji albo świeżego fetchu strony /business/pending) niż wolniejszy w locie
  // refresh() — bez tego dwa równoległe GET (App na starcie + load() strony) mogłyby nadpisać
  // dekrementację nieaktualną wartością, ktokolwiek odpowie później
  private requestId = 0;

  set(value: number): void {
    this.requestId++;
    this.countSignal.set(value);
  }

  decrement(): void {
    this.requestId++;
    this.countSignal.update((c) => Math.max(0, c - 1));
  }

  /** Błąd pobrania jest cichy — plakietka w nawigacji nie jest na tyle krytyczna, żeby
   *  przesłaniać resztę UI alertem; strona /business/pending i tak pokaże własny błąd. */
  async refresh(): Promise<void> {
    if (!this.canHaveBookings()) {
      this.requestId++;
      this.countSignal.set(0);
      return;
    }
    const id = ++this.requestId;
    const { from, to } = pendingRange();
    try {
      const bookings = await firstValueFrom(
        this.api.get<MinimalBooking[]>(
          `/businesses/mine/bookings?${new URLSearchParams({ from, to })}`,
        ),
      );
      // odpowiedź nieaktualna — coś świeższego (set/decrement albo kolejny refresh) już wygrało
      if (id !== this.requestId) return;
      this.countSignal.set(bookings.filter((b) => b.status === 'PENDING').length);
    } catch {
      // patrz komentarz metody — brak zmiany stanu przy błędzie
    }
  }
}
