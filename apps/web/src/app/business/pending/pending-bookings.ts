import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import { formatDateTime } from '../../shared/business-time';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import { CalendarBooking } from '../calendar/booking-details-dialog';
import { PendingCountStore, pendingRange } from '../pending-count-store';

/** Lista rezerwacji PENDING z akcjami akceptuj/odrzuć/odwołaj (#33). GET /businesses/mine/bookings
 *  (#31) nie ma filtra po statusie i wymaga zakresu from/to, więc pobieramy szerokie okno
 *  (pendingRange()) i filtrujemy PENDING po stronie klienta — bez zmian backendu. */
@Component({
  selector: 'app-pending-bookings',
  imports: [PricePlnPipe],
  template: `
    <div class="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Oczekujące rezerwacje</h1>

      @if (loading()) {
        <p class="mt-6 text-sm text-stone-500" role="status">Ładowanie…</p>
      } @else if (serverError(); as msg) {
        <p role="alert" class="alert-danger mt-6">{{ msg }}</p>
        <button type="button" class="btn-primary mt-4 w-auto" (click)="onRetry()">
          Spróbuj ponownie
        </button>
      } @else if (bookings().length) {
        <ul class="mt-6 flex flex-col gap-4">
          @for (b of bookings(); track b.id) {
            <li class="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <h2 class="text-base font-bold">{{ b.service.name }}</h2>
                <span class="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-[13px] font-semibold text-amber-700">
                  Oczekująca
                </span>
              </div>

              <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                <dt class="font-semibold text-stone-600">Klient</dt>
                <dd class="font-medium">{{ b.client.firstName }} {{ b.client.lastName }}</dd>
                @if (b.client.phone; as phone) {
                  <dt class="font-semibold text-stone-600">Telefon</dt>
                  <dd class="font-medium">{{ phone }}</dd>
                }
                <dt class="font-semibold text-stone-600">Termin</dt>
                <dd class="font-medium">{{ formatDateTime(b.startsAt) }}</dd>
                <dt class="font-semibold text-stone-600">Pracownik</dt>
                <dd class="font-medium">{{ b.employee.name }}</dd>
                <dt class="font-semibold text-stone-600">Czas i cena</dt>
                <dd class="font-medium">
                  {{ b.service.durationMin }} min · {{ b.service.priceCents | pricePln }}
                </dd>
                @if (b.clientNote; as note) {
                  <dt class="font-semibold text-stone-600">Notatka klienta</dt>
                  <dd class="font-medium">{{ note }}</dd>
                }
              </dl>

              @if (errorFor(b.id); as msg) {
                <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
              }

              @if (isOwner()) {
                @if (confirmingCancelId() === b.id) {
                  <div class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                    <p class="text-sm font-medium text-rose-800">
                      Na pewno odwołać wizytę „{{ b.service.name }}" —
                      {{ formatDateTime(b.startsAt) }}? Klient zostanie o tym poinformowany.
                    </p>
                    <div class="mt-3 flex gap-2">
                      <button
                        type="button"
                        [disabled]="isBusy(b.id)"
                        (click)="onCancel(b)"
                        class="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-rose-800 disabled:opacity-60"
                      >
                        {{ isBusy(b.id) ? 'Odwoływanie…' : 'Tak, odwołaj' }}
                      </button>
                      <button
                        type="button"
                        [disabled]="isBusy(b.id)"
                        (click)="onCancelCancel()"
                        class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:opacity-60"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      [disabled]="isBusy(b.id)"
                      (click)="onAccept(b)"
                      class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-emerald-800 disabled:opacity-60"
                    >
                      Zaakceptuj
                    </button>
                    <button
                      type="button"
                      [disabled]="isBusy(b.id)"
                      (click)="onReject(b)"
                      class="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                    >
                      Odrzuć
                    </button>
                    <button
                      type="button"
                      [disabled]="isBusy(b.id)"
                      (click)="onRequestCancel(b.id)"
                      class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:opacity-60"
                    >
                      Odwołaj
                    </button>
                  </div>
                }
              }
            </li>
          }
        </ul>
      } @else {
        <p class="mt-6 text-sm text-stone-500">Brak oczekujących rezerwacji.</p>
      }
    </div>
  `,
})
export default class PendingBookings {
  private readonly api = inject(ApiClient);
  private readonly authStore = inject(AuthStore);
  private readonly pendingCountStore = inject(PendingCountStore);

  protected readonly formatDateTime = formatDateTime;
  protected readonly isOwner = computed(
    () => this.authStore.user()?.role === 'OWNER',
  );

  protected readonly bookings = signal<CalendarBooking[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  protected readonly confirmingCancelId = signal<string | null>(null);
  // błąd akcji trzymany per rezerwacja, jak cancelError w my-bookings.ts — nie znika przy
  // udanej akcji na innej karcie
  protected readonly actionError = signal<{ id: string; message: string } | null>(null);
  // zbiór, nie pojedyncze id — dwie karty mogą działać równolegle bez blokowania się nawzajem
  private readonly busy = signal<ReadonlySet<string>>(new Set());

  constructor() {
    void this.load();
  }

  protected isBusy(id: string): boolean {
    return this.busy().has(id);
  }

  protected errorFor(id: string): string | null {
    const err = this.actionError();
    return err?.id === id ? err.message : null;
  }

  protected onRetry(): void {
    void this.load();
  }

  protected onRequestCancel(id: string): void {
    this.confirmingCancelId.set(id);
  }

  protected onCancelCancel(): void {
    this.confirmingCancelId.set(null);
  }

  protected onAccept(booking: CalendarBooking): void {
    void this.runAction(booking, '/confirm');
  }

  protected onReject(booking: CalendarBooking): void {
    void this.runAction(booking, '/decline');
  }

  protected onCancel(booking: CalendarBooking): void {
    void this.runAction(booking, '/cancel-by-business');
  }

  private async runAction(booking: CalendarBooking, path: string): Promise<void> {
    if (this.isBusy(booking.id)) return;

    this.actionError.set(null);
    this.setBusy(booking.id, true);
    try {
      await firstValueFrom(this.api.post(`/bookings/${booking.id}${path}`, {}));
      // AC: lista się aktualizuje bez przeładowania — decyzja usuwa wpis z listy oczekujących
      this.bookings.update((list) => list.filter((b) => b.id !== booking.id));
      this.pendingCountStore.decrement();
      this.confirmingCancelId.set(null);
    } catch (err) {
      this.actionError.set({ id: booking.id, message: apiErrorMessage(err) });
      if (err instanceof HttpErrorResponse && err.status === 409) {
        // status zmienił się poza tą kartą — lista pokazuje nieprawdę, bierzemy świeżą
        await this.load(true);
      }
    } finally {
      this.setBusy(booking.id, false);
    }
  }

  private setBusy(id: string, value: boolean): void {
    this.busy.update((ids) => {
      const next = new Set(ids);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private async load(silent = false): Promise<void> {
    if (!silent) {
      this.loading.set(true);
    }
    this.serverError.set(null);
    try {
      const { from, to } = pendingRange();
      const all = await firstValueFrom(
        this.api.get<CalendarBooking[]>(
          `/businesses/mine/bookings?${new URLSearchParams({ from, to })}`,
        ),
      );
      const pending = all.filter((b) => b.status === 'PENDING');
      this.bookings.set(pending);
      this.pendingCountStore.set(pending.length);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
