import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import { formatDateTime, formatTime } from '../../shared/business-time';
import { I18nStore } from '../../core/i18n/i18n-store';
import type { TranslationKey } from '../../core/i18n/pl';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import { PendingCountStore } from '../pending-count-store';

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

export interface BookingChangedEvent {
  id: string;
  status: BookingStatus;
}

// mirror STATUS_LABELS/STATUS_CLASSES z client/my-bookings.ts — te same 6 statusów, ten sam
// schemat kolorów sprawdzony pod kątem kontrastu AA (odcienie 700 na tle 50/100)
export const STATUS_KEYS: Record<BookingStatus, TranslationKey> = {
  PENDING: 'status.pending',
  CONFIRMED: 'status.confirmed',
  DECLINED: 'status.declined',
  CANCELLED_BY_CLIENT: 'status.cancelledByClient',
  CANCELLED_BY_BUSINESS: 'status.cancelledByBusiness',
  COMPLETED: 'status.completed',
};

export const STATUS_CLASSES: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  DECLINED: 'bg-rose-50 text-rose-700',
  CANCELLED_BY_CLIENT: 'bg-stone-100 text-stone-600',
  CANCELLED_BY_BUSINESS: 'bg-rose-50 text-rose-700',
  COMPLETED: 'bg-stone-100 text-stone-600',
};

/** Szczegóły rezerwacji z kalendarza firmy — podgląd danych i, dla OWNER, decyzje z #33
 *  (akceptuj/odrzuć PENDING, odwołaj PENDING/CONFIRMED). EMPLOYEE widzi te same dane bez
 *  przycisków akcji — rola weryfikowana lokalnie tylko dla UX, backend i tak wymusza @Roles(OWNER). */
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
              >{{ i18n.t(statusKeys[b.status]) }}</span
            >
          </div>

          <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
            <dt class="font-semibold text-stone-600">
              {{ i18n.t('bookingDetails.field.client') }}
            </dt>
            <dd class="font-medium">{{ b.client.firstName }} {{ b.client.lastName }}</dd>
            @if (b.client.phone; as phone) {
              <dt class="font-semibold text-stone-600">
                {{ i18n.t('bookingDetails.field.phone') }}
              </dt>
              <dd class="font-medium">{{ phone }}</dd>
            }
            <dt class="font-semibold text-stone-600">
              {{ i18n.t('bookingDetails.field.slot') }}
            </dt>
            <dd class="font-medium">
              {{
                i18n.t('bookingDetails.slotRange', {
                  from: formatDateTime(b.startsAt),
                  to: formatTime(b.endsAt),
                })
              }}
            </dd>
            <dt class="font-semibold text-stone-600">
              {{ i18n.t('bookingDetails.field.durationAndPrice') }}
            </dt>
            <dd class="font-medium">
              {{
                i18n.t('bookingDetails.durationAndPrice', {
                  minutes: b.service.durationMin,
                  price: b.service.priceCents | pricePln,
                })
              }}
            </dd>
            @if (b.clientNote; as note) {
              <dt class="font-semibold text-stone-600">
                {{ i18n.t('bookingDetails.field.note') }}
              </dt>
              <dd class="font-medium">{{ note }}</dd>
            }
          </dl>

          @if (actionError(); as msg) {
            <p role="alert" class="alert-danger mt-4">{{ msg }}</p>
          }

          @if (canAct() && confirmingCancel()) {
            <div class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p class="text-sm font-medium text-rose-800">
                {{
                  i18n.t('bookingDetails.cancelConfirm', {
                    service: b.service.name,
                    when: formatDateTime(b.startsAt),
                  })
                }}
              </p>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="onConfirmCancel()"
                  class="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-rose-800 disabled:opacity-60"
                >
                  {{
                    busy()
                      ? i18n.t('bookingDetails.cancelling')
                      : i18n.t('bookingDetails.cancelConfirmYes')
                  }}
                </button>
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="onCancelCancel()"
                  class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:opacity-60"
                >
                  {{ i18n.t('bookingDetails.cancelBack') }}
                </button>
              </div>
            </div>
          } @else if (canAct() && (b.status === 'PENDING' || b.status === 'CONFIRMED')) {
            <div class="mt-4 flex flex-wrap gap-2">
              @if (b.status === 'PENDING') {
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="onAccept()"
                  class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-emerald-800 disabled:opacity-60"
                >
                  {{ i18n.t('bookingDetails.accept') }}
                </button>
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="onReject()"
                  class="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  {{ i18n.t('bookingDetails.reject') }}
                </button>
              }
              <button
                type="button"
                [disabled]="busy()"
                (click)="onRequestCancel()"
                class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50 disabled:opacity-60"
              >
                {{ i18n.t('bookingDetails.cancel') }}
              </button>
            </div>
          }

          <button
            type="button"
            class="mt-6 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium shadow-card transition hover:bg-stone-50"
            (click)="dialogEl().nativeElement.close()"
          >
            {{ i18n.t('bookingDetails.close') }}
          </button>
        </div>
      }
    </dialog>
  `,
})
export default class BookingDetailsDialog {
  private readonly api = inject(ApiClient);
  protected readonly i18n = inject(I18nStore);
  private readonly authStore = inject(AuthStore);
  private readonly pendingCountStore = inject(PendingCountStore);

  readonly booking = input<CalendarBooking | null>(null);
  readonly closed = output<void>();
  readonly changed = output<BookingChangedEvent>();
  // niesie id, żeby rodzic mógł sprawdzić, czy dialog wciąż pokazuje TĘ rezerwację, zanim
  // zamknie widok — użytkownik mógł w międzyczasie zamknąć i otworzyć inną (patrz runAction)
  readonly conflict = output<{ id: string }>();

  protected readonly dialogEl =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly statusKeys = STATUS_KEYS;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly formatDateTime = formatDateTime;
  protected readonly formatTime = formatTime;

  protected readonly canAct = computed(() => this.authStore.user()?.role === 'OWNER');
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly confirmingCancel = signal(false);

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

    // nowa rezerwacja (albo zamknięcie) czyści stan poprzedniej akcji — inaczej błąd albo krok
    // potwierdzenia odwołania z poprzednio otwartej wizyty zostawałby widoczny w kolejnej
    effect(() => {
      this.booking();
      this.busy.set(false);
      this.actionError.set(null);
      this.confirmingCancel.set(false);
    });
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogEl().nativeElement) {
      this.dialogEl().nativeElement.close();
    }
  }

  protected onAccept(): void {
    void this.runAction('/confirm', 'CONFIRMED');
  }

  protected onReject(): void {
    void this.runAction('/decline', 'DECLINED');
  }

  protected onRequestCancel(): void {
    this.confirmingCancel.set(true);
  }

  protected onCancelCancel(): void {
    this.confirmingCancel.set(false);
  }

  protected onConfirmCancel(): void {
    void this.runAction('/cancel-by-business', 'CANCELLED_BY_BUSINESS');
  }

  private async runAction(path: string, resultingStatus: BookingStatus): Promise<void> {
    const current = this.booking();
    if (!current || this.busy()) return;

    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.post(`/bookings/${current.id}${path}`, {}));
      if (current.status === 'PENDING') {
        this.pendingCountStore.decrement();
      }
      this.changed.emit({ id: current.id, status: resultingStatus });
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        // status zmienił się poza tym dialogiem — rodzic powinien odświeżyć dane zamiast
        // pokazywać wynik akcji, który już nie jest prawdziwy
        this.conflict.emit({ id: current.id });
        return;
      }
      this.actionError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
      this.confirmingCancel.set(false);
    }
  }
}
