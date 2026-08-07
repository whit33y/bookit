import { HttpErrorResponse } from '@angular/common/http';
import { Component, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../core/api-client';
import { I18nStore } from '../core/i18n/i18n-store';
import type { TranslationKey } from '../core/i18n/pl';
import { translate } from '../core/i18n/translate';
import { formatDateTime } from '../shared/business-time';
import { PricePlnPipe } from '../shared/price-pln.pipe';
import EmptyState from '../shared/ui/empty-state';
import ErrorState from '../shared/ui/error-state';
import LoadingState from '../shared/ui/loading-state';
import RatingStars from '../shared/ui/rating-stars';
import ReviewDialog, { ReviewSubmission } from './review-dialog';

// lustrzane typy backendu — GET /bookings/mine (#28) i POST /bookings/:id/cancel (#27)
type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_BUSINESS'
  | 'COMPLETED';

/** Lustro `PaymentStatus` z apps/api/prisma/schema.prisma. `REFUNDED` dokłada dopiero #52 —
 *  jest tu już teraz, żeby zwrócona zaliczka od razu dostała etykietę, a nie pustą komórkę. */
type PaymentStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

/** Zaliczka wizyty (#51). Bez `clientSecret` — ten wychodzi wyłącznie z POST /bookings. */
interface BookingPayment {
  status: PaymentStatus;
  amountCents: number;
}

/** Wystawiona recenzja albo null — GET /bookings/mine i POST /bookings/:id/review (#47).
 *  Backend dokłada to pole wprost po to, by odróżnić odbytą wizytę bez oceny od ocenionej. */
interface BookingReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

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
  review: BookingReview | null;
  /** null = usługa bez zaliczki, cała płatność na miejscu. */
  payment: BookingPayment | null;
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
const STATUS_KEYS: Record<BookingStatus, TranslationKey> = {
  PENDING: 'status.pending',
  CONFIRMED: 'status.confirmed',
  DECLINED: 'status.declined',
  // „przez Ciebie", nie „przez klienta": to jego własna lista wizyt (panel firmy ma swój wariant)
  CANCELLED_BY_CLIENT: 'status.cancelledByYou',
  CANCELLED_BY_BUSINESS: 'status.cancelledByBusiness',
  COMPLETED: 'status.completed',
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

// Stan zaliczki (#53). Etykiety nazywają rzecz z punktu widzenia klienta („zaliczka
// niepobrana"), a nie stanem PaymentIntenta — `CANCELLED` na płatności znaczy tyle, że
// rezerwacja wygasła nieopłacona i nikt nic nie pobrał.
const PAYMENT_KEYS: Record<PaymentStatus, TranslationKey> = {
  PENDING: 'payment.status.pending',
  SUCCEEDED: 'payment.status.succeeded',
  FAILED: 'payment.status.failed',
  CANCELLED: 'payment.status.cancelled',
  REFUNDED: 'payment.status.refunded',
};

// Te same odcienie 700 na tłach 50/100 co przy statusie wizyty — kontrast ponad 4.5:1,
// a kolor wyłącznie dubluje etykietę, nigdy nie niesie informacji sam (WCAG 1.4.1).
const PAYMENT_CLASSES: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  SUCCEEDED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-stone-100 text-stone-600',
  REFUNDED: 'bg-sky-50 text-sky-700',
};

@Component({
  selector: 'app-my-bookings',
  imports: [
    PricePlnPipe,
    RouterLink,
    LoadingState,
    ErrorState,
    EmptyState,
    RatingStars,
    ReviewDialog,
  ],
  template: `
    <div class="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
        {{ i18n.t('myBookings.title') }}
      </h1>

      @if (loading()) {
        <app-loading-state class="mt-6" [message]="i18n.t('myBookings.loading')" />
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
          [attr.aria-label]="i18n.t('myBookings.tablistLabel')"
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
              {{
                i18n.t('myBookings.tabWithCount', {
                  label: i18n.t(t.labelKey),
                  count: count(t.id),
                })
              }}
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
                <!-- id + tabindex: wizyta wskazana z powiadomienia (#54) dostaje fokus, żeby
                     użytkownik klawiatury i czytnika trafił tam, gdzie link obiecywał -->
                <li
                  [id]="'booking-' + b.id"
                  [attr.tabindex]="highlightedId() === b.id ? -1 : null"
                  class="rounded-2xl border border-stone-200 bg-white p-5 shadow-card focus-visible:outline-none"
                  [class]="
                    highlightedId() === b.id ? 'ring-2 ring-brand-600 ring-offset-2' : ''
                  "
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
                    <dt class="font-semibold text-stone-600">
                      {{ i18n.t('myBookings.field.slot') }}
                    </dt>
                    <dd class="font-medium">{{ dateTime(b.startsAt) }}</dd>
                    <dt class="font-semibold text-stone-600">
                      {{ i18n.t('myBookings.field.employee') }}
                    </dt>
                    <dd class="font-medium">{{ b.employee.name }}</dd>
                    <dt class="font-semibold text-stone-600">
                      {{ i18n.t('myBookings.field.durationAndPrice') }}
                    </dt>
                    <dd class="font-medium">
                      {{
                        i18n.t('myBookings.durationAndPrice', {
                          minutes: b.service.durationMin,
                          price: b.service.priceCents | pricePln,
                        })
                      }}
                    </dd>
                    <dt class="font-semibold text-stone-600">
                      {{ i18n.t('myBookings.field.address') }}
                    </dt>
                    <dd class="font-medium">
                      {{ b.business.street }}, {{ b.business.postalCode }}
                      {{ b.business.city }}
                    </dd>
                    @if (b.business.phone; as phone) {
                      <dt class="font-semibold text-stone-600">
                        {{ i18n.t('myBookings.field.phone') }}
                      </dt>
                      <dd class="font-medium">{{ phone }}</dd>
                    }
                    @if (b.payment; as payment) {
                      <dt class="font-semibold text-stone-600">
                        {{ i18n.t('myBookings.field.deposit') }}
                      </dt>
                      <dd class="font-medium">
                        {{ payment.amountCents | pricePln }}
                        <span
                          class="ml-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
                          [class]="paymentClass(payment.status)"
                          >{{ paymentLabel(payment.status) }}</span
                        >
                      </dd>
                    }
                    @if (b.clientNote; as note) {
                      <dt class="font-semibold text-stone-600">
                        {{ i18n.t('myBookings.field.note') }}
                      </dt>
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
                      {{
                        isCancelling(b.id)
                          ? i18n.t('myBookings.cancelling')
                          : i18n.t('myBookings.cancel')
                      }}
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

                  <!-- Wystawiona ocena i akcja oceniania wykluczają się z definicji (recenzja
                       albo jest, albo jej nie ma); osobny blok od odwołania, bo front nie
                       powtarza reguł backendu o tym, co może współistnieć. -->
                  @if (b.review; as review) {
                    <div class="mt-4 border-t border-stone-100 pt-4">
                      <p class="text-xs font-semibold uppercase tracking-wider text-stone-400">
                        {{ i18n.t('myBookings.reviewGiven') }}
                      </p>
                      <app-rating-stars class="mt-1.5" [value]="review.rating" />
                      @if (review.comment; as comment) {
                        <p class="mt-2 text-sm leading-relaxed text-stone-600">
                          {{ comment }}
                        </p>
                      }
                      <p class="mt-1.5 text-[13px] text-stone-400">
                        {{
                          i18n.t('myBookings.reviewGivenAt', {
                            when: dateTime(review.createdAt),
                          })
                        }}
                      </p>
                    </div>
                  } @else if (canReview(b)) {
                    <button
                      type="button"
                      (click)="openReview(b)"
                      class="mt-4 rounded-lg bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      {{ i18n.t('myBookings.review') }}
                    </button>
                  }
                </li>
              }
            </ul>
          } @else {
            <app-empty-state [title]="emptyMessage()" />
          }
        </div>
      }

      <!-- jeden modal na cały ekran, poza @for: lista pięciu wizyt nie potrzebuje pięciu
           dialogów, a <dialog> i tak pokazuje się tylko jeden naraz -->
      <app-review-dialog
        [open]="reviewTarget() !== null"
        [serviceName]="reviewServiceName()"
        [startsAt]="reviewStartsAt()"
        [busy]="reviewBusy()"
        [serverError]="reviewError()"
        (submitted)="onReviewSubmit($event)"
        (cancelled)="closeReview()"
      />
    </div>
  `,
})
export default class MyBookings {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nStore);

  protected readonly dateTime = formatDateTime;
  protected readonly tabs = [
    { id: 'upcoming', labelKey: 'myBookings.tab.upcoming' },
    { id: 'past', labelKey: 'myBookings.tab.past' },
  ] as const satisfies readonly { id: Tab; labelKey: TranslationKey }[];

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

  // wizyta oceniana w tej chwili — null zamyka modal; stan sieciowy recenzji jest osobny
  // od odwoływania, bo obie akcje mogą dotyczyć różnych kart
  protected readonly reviewTarget = signal<ClientBooking | null>(null);
  protected readonly reviewBusy = signal(false);
  protected readonly reviewError = signal<string | null>(null);

  protected readonly tab = signal<Tab>('upcoming');

  // wizyta wskazana przez ?booking= (deep-link z powiadomienia in-app, #54)
  protected readonly highlightedId = signal<string | null>(null);
  private requestedId: string | null = null;

  protected readonly visible = computed(() =>
    this.tab() === 'upcoming' ? this.upcoming() : this.past(),
  );

  protected readonly reviewServiceName = computed(
    () => this.reviewTarget()?.service.name ?? '',
  );
  protected readonly reviewStartsAt = computed(
    () => this.reviewTarget()?.startsAt ?? '',
  );

  protected readonly emptyMessage = computed(() =>
    this.tab() === 'upcoming'
      ? translate('myBookings.empty.upcoming')
      : translate('myBookings.empty.past'),
  );

  constructor() {
    void this.load();

    // queryParamMap, nie snapshot: drugi klik w powiadomienie, gdy ten ekran jest już otwarty,
    // zmienia tylko query param — komponent nie powstaje od nowa, a podświetlenie ma przeskoczyć
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.requestedId = params.get('booking');
      this.highlightRequested();
    });

    // Fokus i przewinięcie dopiero po renderze: karta wchodzi do DOM razem z przełączoną
    // zakładką, więc w momencie zapisu sygnału jeszcze jej nie ma. afterRenderEffect zamiast
    // setTimeout, bo aplikacja jest zoneless i moment renderu należy do Angulara, nie do zegara.
    afterRenderEffect(() => {
      const id = this.highlightedId();
      if (!id) return;
      const card = document.getElementById(`booking-${id}`);
      card?.focus({ preventScroll: true });
      // jsdom nie implementuje scrollIntoView — w testach po prostu go nie ma
      card?.scrollIntoView?.({ block: 'center' });
    });
  }

  protected count(tab: Tab): number {
    return tab === 'upcoming' ? this.upcoming().length : this.past().length;
  }

  protected statusLabel(status: BookingStatus): string {
    return this.i18n.t(STATUS_KEYS[status]);
  }

  protected statusClass(status: BookingStatus): string {
    return STATUS_CLASSES[status];
  }

  protected paymentLabel(status: PaymentStatus): string {
    return this.i18n.t(PAYMENT_KEYS[status]);
  }

  protected paymentClass(status: PaymentStatus): string {
    return PAYMENT_CLASSES[status];
  }

  protected cancellationNote(hours: number): string {
    return this.i18n.t('myBookings.cancellationNote', { hours });
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

  /** Regułę „tylko po odbytej wizycie" trzyma backend (409) — front chowa akcję, której i tak
   *  nie da się wykonać, ale nie powtarza warunku na endsAt, żeby nie rozjechać się z serwerem. */
  protected canReview(booking: ClientBooking): boolean {
    return booking.status === 'COMPLETED' && booking.review === null;
  }

  protected openReview(booking: ClientBooking): void {
    this.reviewError.set(null);
    this.reviewTarget.set(booking);
  }

  protected closeReview(): void {
    if (this.reviewBusy()) return;
    this.reviewTarget.set(null);
  }

  protected async onReviewSubmit({
    rating,
    comment,
  }: ReviewSubmission): Promise<void> {
    const target = this.reviewTarget();
    if (!target || this.reviewBusy()) return;

    this.reviewError.set(null);
    this.reviewBusy.set(true);
    try {
      // pustego komentarza nie wysyłamy jako '' — DTO ma go za opcjonalny, a ValidationPipe
      // z forbidNonWhitelisted nie wybacza pól spoza kontraktu
      const body = comment === null ? { rating } : { rating, comment };
      const created = await firstValueFrom(
        this.api.post<BookingReview>(`/bookings/${target.id}/review`, body),
      );
      // AC: akcja znika, a ocena pokazuje się bez przeładowania strony — podmieniamy jeden
      // rekord w sygnale, tak samo jak przy odwołaniu wizyty
      this.patchBooking(target.id, { review: created });
      this.reviewTarget.set(null);
    } catch (err) {
      this.reviewError.set(apiErrorMessage(err));
      if (err instanceof HttpErrorResponse && err.status === 409) {
        // recenzja powstała gdzie indziej albo status wizyty się zmienił — lista pokazuje
        // nieprawdę, więc bierzemy świeżą zamiast zgadywać stan
        await this.load(true);
      }
    } finally {
      this.reviewBusy.set(false);
    }
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
      translate('myBookings.cancelConfirm', {
        service: booking.service.name,
        when: formatDateTime(booking.startsAt),
      }),
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

  /**
   * Podświetlenie wizyty z `?booking=` (AC #54 „klik prowadzi do wizyty"). Rezerwacja może
   * leżeć w dowolnej z dwóch zakładek, więc najpierw trzeba ją znaleźć, a dopiero potem
   * przełączyć widok. Nieznane id ignorujemy cicho: wizyta mogła zniknąć z listy, a błąd
   * w tym miejscu nic nie daje użytkownikowi, który przyszedł tu z powiadomienia.
   */
  private highlightRequested(): void {
    const id = this.requestedId;
    if (!id) {
      this.highlightedId.set(null);
      return;
    }

    const tab: Tab | null = this.upcoming().some((b) => b.id === id)
      ? 'upcoming'
      : this.past().some((b) => b.id === id)
        ? 'past'
        : null;
    if (!tab) return;

    this.tab.set(tab);
    // fokus i przewinięcie dokłada afterRenderEffect z konstruktora
    this.highlightedId.set(id);
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
      // dopiero teraz wiadomo, w której zakładce leży wizyta z ?booking=
      this.highlightRequested();
    } catch (err) {
      this.serverError.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
