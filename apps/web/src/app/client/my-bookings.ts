import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { formatDateTime } from '../shared/business-time';
import { PricePlnPipe } from '../shared/price-pln.pipe';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';

// lustrzane typy backendu — GET /bookings/mine (#28) i POST /bookings/:id/cancel (#27)
type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_BUSINESS'
  | 'COMPLETED';

interface ClientBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  clientNote: string | null;
  createdAt: string;
  business: {
    id: string;
    slug: string;
    name: string;
    phone: string | null;
    street: string;
    city: string;
    postalCode: string;
    cancellationHours: number;
  };
  service: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
  };
  employee: { id: string; name: string };
  // liczy backend wg polityki firmy — front nie powtarza tej reguły u siebie (AC #28)
  canCancel: boolean;
}

interface MyBookingsResponse {
  upcoming: ClientBooking[];
  past: ClientBooking[];
}

/** POST /bookings/:id/cancel zwraca bookingSelect — z listy interesuje nas tylko nowy status. */
interface CancelledBooking {
  id: string;
  status: BookingStatus;
}

type Tab = 'upcoming' | 'past';

// Lustro STATUS_LABELS z apps/api/src/app/bookings/booking-status.ts, ale w mianowniku i z
// wielkiej litery — tam etykiety wpadają w środek zdania („Rezerwacja jest odwołana…"),
// tutaj stoją samodzielnie w badge'u.
const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: 'Oczekująca',
  CONFIRMED: 'Potwierdzona',
  DECLINED: 'Odrzucona',
  CANCELLED_BY_CLIENT: 'Odwołana przez Ciebie',
  CANCELLED_BY_BUSINESS: 'Odwołana przez firmę',
  COMPLETED: 'Zakończona',
};

// Odcienie 700 na tle 50/100 — kontrast ponad 4.5:1 (WCAG AA). Kolor tylko dubluje etykietę,
// nigdy nie niesie informacji sam (WCAG 1.4.1).
const STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  DECLINED: 'bg-rose-50 text-rose-700',
  CANCELLED_BY_CLIENT: 'bg-stone-100 text-stone-600',
  CANCELLED_BY_BUSINESS: 'bg-rose-50 text-rose-700',
  COMPLETED: 'bg-stone-100 text-stone-600',
};

@Component({
  selector: 'app-my-bookings',
  imports: [PricePlnPipe, RouterLink, LoadingState, ErrorState, EmptyState],
  template: `
    <div class="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Moje wizyty</h1>

      @if (loading()) {
        <app-loading-state class="mt-6" message="Ładowanie wizyt…" />
      } @else if (serverError(); as msg) {
        <!-- pusta lista i nieudane pobranie to dwie różne rzeczy: bez tej gałęzi klient
             z wizytami zobaczyłby „nie masz zaplanowanych wizyt" pod komunikatem o błędzie -->
        <app-error-state
          class="mt-6"
          [message]="msg"
          [retryable]="true"
          (retry)="onRetry()"
        />
      } @else {
        <div
          role="tablist"
          aria-label="Zakres wizyt"
          class="mt-6 flex gap-2 border-b border-stone-200"
        >
          @for (t of tabs; track t.id) {
            <button
              type="button"
              role="tab"
              [id]="'tab-' + t.id"
              aria-controls="panel-wizyty"
              [attr.aria-selected]="tab() === t.id"
              [tabindex]="tab() === t.id ? 0 : -1"
              (click)="selectTab(t.id)"
              (keydown)="onTabKeydown($event)"
              class="-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              [class]="
                tab() === t.id
                  ? 'border-brand-700 text-brand-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              "
            >
              {{ t.label }} ({{ count(t.id) }})
            </button>
          }
        </div>

        <div
          id="panel-wizyty"
          role="tabpanel"
          [attr.aria-labelledby]="'tab-' + tab()"
          tabindex="0"
          class="mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          @if (visible().length) {
            <ul class="flex flex-col gap-4">
              @for (b of visible(); track b.id) {
                <li
                  class="rounded-2xl border border-stone-200 bg-white p-5 shadow-card"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 class="text-base font-bold">{{ b.service.name }}</h2>
                      <a
                        [routerLink]="['/', b.business.slug]"
                        class="text-sm font-medium text-brand-700 hover:underline"
                        >{{ b.business.name }}</a
                      >
                    </div>
                    <span
                      class="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold"
                      [class]="statusClass(b.status)"
                      >{{ statusLabel(b.status) }}</span
                    >
                  </div>

                  <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                    <dt class="font-semibold text-stone-600">Termin</dt>
                    <dd class="font-medium">{{ dateTime(b.startsAt) }}</dd>
                    <dt class="font-semibold text-stone-600">Pracownik</dt>
                    <dd class="font-medium">{{ b.employee.name }}</dd>
                    <dt class="font-semibold text-stone-600">Czas i cena</dt>
                    <dd class="font-medium">
                      {{ b.service.durationMin }} min ·
                      {{ b.service.priceCents | pricePln }}
                    </dd>
                    <dt class="font-semibold text-stone-600">Adres</dt>
                    <dd class="font-medium">
                      {{ b.business.street }}, {{ b.business.postalCode }}
                      {{ b.business.city }}
                    </dd>
                    @if (b.business.phone; as phone) {
                      <dt class="font-semibold text-stone-600">Telefon</dt>
                      <dd class="font-medium">{{ phone }}</dd>
                    }
                    @if (b.clientNote; as note) {
                      <dt class="font-semibold text-stone-600">Twoja notatka</dt>
                      <dd class="font-medium">{{ note }}</dd>
                    }
                  </dl>

                  <!-- błąd odwołania siedzi przy swojej wizycie, nie na górze ekranu: przy
                       dłuższej liście komunikat nad nagłówkiem wypadłby poza widok -->
                  @if (cancelErrorFor(b.id); as msg) {
                    <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
                  }

                  @if (b.canCancel) {
                    <button
                      type="button"
                      [disabled]="isCancelling(b.id)"
                      (click)="onCancel(b)"
                      class="mt-4 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:text-stone-400"
                    >
                      {{ isCancelling(b.id) ? 'Odwoływanie…' : 'Odwołaj wizytę' }}
                    </button>
                  } @else if (b.status === 'CONFIRMED' && tab() === 'upcoming') {
                    <!-- Jedyny powód, dla którego *nadchodząca* potwierdzona wizyta traci
                         przycisk, to okno z polityki firmy — bez tego zdania brak przycisku
                         wygląda na błąd. W historii ta rada nie ma sensu: tam CONFIRMED znaczy
                         tylko tyle, że cron z #39 jeszcze nie domknął wizyty do COMPLETED. -->
                    <p class="mt-4 text-[13px] text-stone-500">
                      {{ cancellationNote(b.business.cancellationHours) }}
                    </p>
                  }
                </li>
              }
            </ul>
          } @else {
            <app-empty-state [title]="emptyMessage()" />
          }
        </div>
      }
    </div>
  `,
})
export default class MyBookings {
  private readonly api = inject(ApiClient);

  protected readonly dateTime = formatDateTime;
  protected readonly tabs = [
    { id: 'upcoming', label: 'Nadchodzące' },
    { id: 'past', label: 'Historia' },
  ] as const satisfies readonly { id: Tab; label: string }[];

  protected readonly upcoming = signal<ClientBooking[]>([]);
  protected readonly past = signal<ClientBooking[]>([]);
  protected readonly loading = signal(true);
  protected readonly serverError = signal<string | null>(null);
  // osobno od serverError i z id wizyty: błąd odwołania nie może zniknąć razem
  // z przeładowaniem listy, które sam wywołuje przy 409, i ma się pokazać przy swojej karcie
  protected readonly cancelError = signal<{ id: string; message: string } | null>(
    null,
  );
  // zbiór, nie pojedyncze id: dwa odwołania mogą lecieć równolegle (dialog blokuje tylko
  // do potwierdzenia), a przy skalarze odpowiedź na pierwsze odblokowywała przycisk drugiego
  private readonly cancelling = signal<ReadonlySet<string>>(new Set());

  protected readonly tab = signal<Tab>('upcoming');

  protected readonly visible = computed(() =>
    this.tab() === 'upcoming' ? this.upcoming() : this.past(),
  );

  protected readonly emptyMessage = computed(() =>
    this.tab() === 'upcoming'
      ? 'Nie masz zaplanowanych wizyt. Znajdź firmę i zarezerwuj termin.'
      : 'Nie masz jeszcze minionych wizyt.',
  );

  constructor() {
    void this.load();
  }

  protected count(tab: Tab): number {
    return tab === 'upcoming' ? this.upcoming().length : this.past().length;
  }

  protected statusLabel(status: BookingStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusClass(status: BookingStatus): string {
    return STATUS_CLASSES[status];
  }

  protected cancellationNote(hours: number): string {
    return `Tę wizytę można było odwołać najpóźniej ${hours} h przed terminem — skontaktuj się z firmą.`;
  }

  protected selectTab(tab: Tab): void {
    this.tab.set(tab);
  }

  protected isCancelling(id: string): boolean {
    return this.cancelling().has(id);
  }

  protected cancelErrorFor(id: string): string | null {
    const err = this.cancelError();
    return err?.id === id ? err.message : null;
  }

  protected onRetry(): void {
    void this.load();
  }

  /** Wzorzec „tabs" z ARIA APG: strzałki przełączają zakładki, Home/End skacze na skrajną.
   *  Samo aria-selected bez tej obsługi nie wystarcza — tablist ma jeden stop tabulatora,
   *  więc bez strzałek drugiej zakładki nie da się dosięgnąć z klawiatury. */
  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const current = ids.indexOf(this.tab());
    let next: Tab | null = null;
    if (event.key === 'ArrowRight') {
      next = ids[(current + 1) % ids.length];
    } else if (event.key === 'ArrowLeft') {
      next = ids[(current - 1 + ids.length) % ids.length];
    } else if (event.key === 'Home') {
      next = ids[0];
    } else if (event.key === 'End') {
      next = ids[ids.length - 1];
    }
    if (!next) return;

    event.preventDefault();
    this.tab.set(next);
    // aktywacja automatyczna — focus musi iść za zaznaczeniem, inaczej roving tabindex
    // zostawia focus na przycisku, który przed chwilą stracił tabindex=0
    const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
    tablist?.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus();
  }

  protected async onCancel(booking: ClientBooking): Promise<void> {
    if (this.isCancelling(booking.id)) return;

    // odwołanie jest nieodwracalne (stan terminalny w maszynie statusów) — pytamy przed akcją
    const ok = globalThis.confirm(
      `Odwołać wizytę „${booking.service.name}" — ${formatDateTime(booking.startsAt)}?`,
    );
    if (!ok) return;

    this.cancelError.set(null);
    this.setCancelling(booking.id, true);
    try {
      const updated = await firstValueFrom(
        this.api.post<CancelledBooking>(`/bookings/${booking.id}/cancel`, {}),
      );
      // AC: status odświeża się bez przeładowania strony — podmieniamy jeden rekord w sygnale
      // zamiast ponownie pobierać całą listę. canCancel gaśnie: stan terminalny nie wraca.
      this.patchBooking(booking.id, { status: updated.status, canCancel: false });
    } catch (err) {
      this.cancelError.set({ id: booking.id, message: apiErrorMessage(err) });
      if (err instanceof HttpErrorResponse && err.status === 409) {
        // status zmienił się poza tą kartą (firma odwołała, polityka wygasła) — lista
        // pokazuje nieprawdę, więc bierzemy świeżą zamiast zgadywać nowy stan
        await this.load(true);
      }
    } finally {
      this.setCancelling(booking.id, false);
    }
  }

  private setCancelling(id: string, busy: boolean): void {
    this.cancelling.update((ids) => {
      const next = new Set(ids);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /** Rezerwacja siedzi w jednej z dwóch list, ale nie wiadomo w której: zaległy PENDING
   *  z przeszłości też ma canCancel, bo maszyna stanów na to pozwala. */
  private patchBooking(id: string, patch: Partial<ClientBooking>): void {
    const apply = (list: ClientBooking[]) =>
      list.map((b) => (b.id === id ? { ...b, ...patch } : b));
    this.upcoming.update(apply);
    this.past.update(apply);
  }

  private async load(silent = false): Promise<void> {
    if (!silent) {
      this.loading.set(true);
    }
    this.serverError.set(null);
    try {
      const res = await firstValueFrom(
        this.api.get<MyBookingsResponse>('/bookings/mine'),
      );
      this.upcoming.set(res.upcoming);
      this.past.set(res.past);
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
