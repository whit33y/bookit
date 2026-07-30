import {
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { formatDateTime, formatTime } from '../../shared/business-time';
import { PricePlnPipe } from '../../shared/price-pln.pipe';

// lustrzane typy backendu — businessBookingSelect w bookings.service.ts
// (GET /businesses/mine/bookings, #31)
export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_BUSINESS'
  | 'COMPLETED';

export interface CalendarBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  clientNote: string | null;
  client: { firstName: string; lastName: string; phone: string | null };
  service: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
  };
  employee: { id: string; name: string };
}

// mirror STATUS_LABELS/STATUS_CLASSES z client/my-bookings.ts — te same 6 statusów, ten sam
// schemat kolorów sprawdzony pod kątem kontrastu AA (odcienie 700 na tle 50/100)
export const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: 'Oczekująca',
  CONFIRMED: 'Potwierdzona',
  DECLINED: 'Odrzucona',
  CANCELLED_BY_CLIENT: 'Odwołana przez klienta',
  CANCELLED_BY_BUSINESS: 'Odwołana przez firmę',
  COMPLETED: 'Zakończona',
};

export const STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  DECLINED: 'bg-rose-50 text-rose-700',
  CANCELLED_BY_CLIENT: 'bg-stone-100 text-stone-600',
  CANCELLED_BY_BUSINESS: 'bg-rose-50 text-rose-700',
  COMPLETED: 'bg-stone-100 text-stone-600',
};

/** Podgląd szczegółów rezerwacji z kalendarza firmy — tylko odczyt. Akcje (akceptuj/odrzuć/
 *  odwołaj) to zakres #33; ten komponent zostanie wtedy rozszerzony bez zmian w siatce kalendarza. */
@Component({
  selector: 'app-booking-details-dialog',
  imports: [PricePlnPipe],
  template: `
    <!-- klik w tło zamyka dialog — wygoda myszy, nie jedyna droga: natywny <dialog>
         zamyka się też klawiszem Escape i ma wbudowany trap fokusu -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="rounded-xl border border-stone-200 p-0 shadow-card backdrop:bg-stone-900/40"
      (close)="closed.emit()"
      (click)="onBackdropClick($event)"
    >
      @if (booking(); as b) {
        <div class="w-[min(28rem,90vw)] p-6">
          <div class="flex items-start justify-between gap-3">
            <h2 class="text-lg font-bold">{{ b.service.name }}</h2>
            <span
              class="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold"
              [class]="statusClasses[b.status]"
              >{{ statusLabels[b.status] }}</span
            >
          </div>

          <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
            <dt class="font-semibold text-stone-600">Klient</dt>
            <dd class="font-medium">{{ b.client.firstName }} {{ b.client.lastName }}</dd>
            @if (b.client.phone; as phone) {
              <dt class="font-semibold text-stone-600">Telefon</dt>
              <dd class="font-medium">{{ phone }}</dd>
            }
            <dt class="font-semibold text-stone-600">Termin</dt>
            <dd class="font-medium">
              {{ formatDateTime(b.startsAt) }} – {{ formatTime(b.endsAt) }}
            </dd>
            <dt class="font-semibold text-stone-600">Czas i cena</dt>
            <dd class="font-medium">
              {{ b.service.durationMin }} min · {{ b.service.priceCents | pricePln }}
            </dd>
            @if (b.clientNote; as note) {
              <dt class="font-semibold text-stone-600">Notatka klienta</dt>
              <dd class="font-medium">{{ note }}</dd>
            }
          </dl>

          <button
            type="button"
            class="mt-6 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50"
            (click)="dialogEl().nativeElement.close()"
          >
            Zamknij
          </button>
        </div>
      }
    </dialog>
  `,
})
export default class BookingDetailsDialog {
  readonly booking = input<CalendarBooking | null>(null);
  readonly closed = output<void>();

  protected readonly dialogEl =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly formatDateTime = formatDateTime;
  protected readonly formatTime = formatTime;

  constructor() {
    // synchronizacja z imperatywnym API <dialog> — showModal()/close() dają trap fokusu
    // i powrót fokusu do wywołującego elementu „za darmo" (WCAG AA, FRONTEND_CLAUDE.md)
    effect(() => {
      const dialog = this.dialogEl().nativeElement;
      if (this.booking() && !dialog.open) {
        dialog.showModal();
      }
      if (!this.booking() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogEl().nativeElement) {
      this.dialogEl().nativeElement.close();
    }
  }
}
