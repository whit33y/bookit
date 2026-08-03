import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient, apiErrorMessage } from '../../core/api-client';
import { AuthStore } from '../../core/auth/auth-store';
import {
  formatDateTime,
  formatTime,
  todayInBusinessTz,
} from '../../shared/business-time';
import { DepositType, depositAmountCents } from '../../shared/deposit';
import { PricePlnPipe } from '../../shared/price-pln.pipe';
import EmptyState from '../../shared/ui/empty-state';
import ErrorState from '../../shared/ui/error-state';
import LoadingState from '../../shared/ui/loading-state';
import { StripeLoader } from '../../shared/payments/stripe-loader';
import NotFound from '../not-found/not-found';
import DepositPayment from './deposit-payment';

// lustrzane typy backendu — GET /businesses/:slug (#15), GET /businesses/:slug/availability (#24),
// POST /bookings (#25). Repo nie ma wspólnej libki DTO, każdy front-owy typ jest lustrem.
interface PublicBusiness {
  id: string;
  slug: string;
  name: string;
  services: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    // zaliczka per usługa (#50) — null/null znaczy „cała płatność na miejscu"
    depositType: DepositType | null;
    depositValue: number | null;
    employees: { id: string; name: string }[];
  }[];
}

export interface AvailableSlot {
  employeeId: string;
  startsAt: string; // ISO 8601, UTC
}

/** Zaliczka do opłacenia — wyłącznie w odpowiedzi na POST /bookings (#51), nigdy na listach. */
interface BookingPayment {
  amountCents: number;
  currency: string;
  clientSecret: string;
  /** ISO 8601 — koniec okna na opłacenie, liczony na backendzie przez `paymentDeadline()`. */
  expiresAt: string;
}

interface Booking {
  id: string;
  employeeId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  /** null = usługa bez zaliczki; rezerwacja jest kompletna od razu. */
  payment: BookingPayment | null;
}

/** Wartość kroku 2 oznaczająca „bez preferencji" — do availability leci wtedy bez employeeId. */
const ANY_EMPLOYEE = 'any';

/** Sloty „dowolnego" pracownika to ta sama godzina powtórzona per pracownik — użytkownik ma
 *  zobaczyć jedną pozycję na godzinę. Backend sortuje po startsAt, potem po employeeId, więc
 *  „pierwszy wygrywa" jest deterministyczne, a POST /bookings i tak wymaga konkretnego pracownika. */
export function groupSlotsByStart(slots: AvailableSlot[]): AvailableSlot[] {
  const byStart = new Map<string, AvailableSlot>();
  for (const slot of slots) {
    if (!byStart.has(slot.startsAt)) {
      byStart.set(slot.startsAt, slot);
    }
  }
  return [...byStart.values()];
}

@Component({
  selector: 'app-booking-wizard',
  imports: [
    PricePlnPipe,
    NotFound,
    RouterLink,
    LoadingState,
    ErrorState,
    EmptyState,
    DepositPayment,
  ],
  template: `
    @if (loading()) {
      <div class="flex flex-1 items-center justify-center px-4 py-16">
        <app-loading-state />
      </div>
    } @else if (notFound()) {
      <app-not-found />
    } @else if (serverError(); as msg) {
      <div class="mx-auto w-full max-w-3xl px-4 py-8">
        <app-error-state [message]="msg" [retryable]="true" (retry)="retry()" />
      </div>
    } @else if (business(); as b) {
      <div class="mx-auto w-full max-w-3xl px-4 py-8">
        @if (redirectedPayment(); as result) {
          <!-- Wróciliśmy z BLIK-a/Przelewów24: rezerwacja już istnieje, ale nie ma jej
               w pamięci tej instancji kreatora — pokazujemy sam wynik płatności i odsyłamy
               po szczegóły do „Moich wizyt". -->
          <section class="rounded-2xl border border-stone-200 bg-white p-8 shadow-card">
            <h1
              #potwierdzenie
              tabindex="-1"
              class="text-xl font-bold tracking-tight outline-none sm:text-2xl"
            >
              {{ redirectHeading(result) }}
            </h1>
            @switch (result) {
              @case ('paid') {
                <p class="mt-3 text-sm leading-relaxed text-stone-600">
                  Dziękujemy — termin jest opłacony. Firma potwierdzi wizytę, a status
                  znajdziesz w sekcji „Moje wizyty".
                </p>
              }
              @case ('failed') {
                <!-- świadomie bez „zapłać ponownie w Moich wizytach": ponowienie żyje tylko
                     w kreatorze, dopóki trzyma client_secret, a ten po przekierowaniu przepadł -->
                <p role="alert" class="alert-danger mt-3">
                  Nie otrzymaliśmy zaliczki, więc ta rezerwacja wygaśnie i termin wróci
                  do puli wolnych. Zarezerwuj go jeszcze raz, jeśli nadal jest dostępny.
                </p>
              }
              @default {
                <!-- nie wiemy, czy pieniądze wyszły — najgorsze, co można tu zrobić, to
                     wypchnąć klienta w drugą płatność za tę samą wizytę -->
                <p role="alert" class="alert-danger mt-3">
                  Nie udało się sprawdzić, czy płatność doszła do skutku. Nie płać
                  drugi raz — aktualny stan zaliczki znajdziesz w sekcji „Moje wizyty".
                </p>
              }
            }
            <div class="mt-6 flex flex-wrap gap-3">
              <a routerLink="/client" class="btn-primary w-auto">Moje wizyty</a>
              <a
                routerLink="../"
                class="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >Wróć do profilu firmy</a
              >
            </div>
          </section>
        } @else if (createdBooking(); as booking) {
          <section class="rounded-2xl border border-stone-200 bg-white p-8 shadow-card">
            <!-- focus wędruje na nagłówek: po zapisie znika cały wizard razem z aktywnym
                 przyciskiem, więc bez tego czytnik ekranu zostaje bez kontekstu (WCAG 2.4.3) -->
            <h1
              #potwierdzenie
              tabindex="-1"
              class="text-xl font-bold tracking-tight outline-none sm:text-2xl"
            >
              {{ awaitingDeposit() ? 'Termin zarezerwowany' : 'Rezerwacja przyjęta' }}
            </h1>
            <p
              class="mt-3 inline-block rounded-full px-3 py-1 text-sm font-semibold"
              [class]="
                awaitingDeposit()
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-emerald-50 text-emerald-700'
              "
            >
              {{
                awaitingDeposit()
                  ? 'Czeka na opłacenie zaliczki'
                  : 'Oczekuje na akceptację firmy'
              }}
            </p>

            <dl class="mt-6 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt class="font-semibold text-stone-600">Firma</dt>
              <dd class="font-medium">{{ b.name }}</dd>
              <dt class="font-semibold text-stone-600">Usługa</dt>
              <dd class="font-medium">{{ selectedService()?.name }}</dd>
              <dt class="font-semibold text-stone-600">Pracownik</dt>
              <dd class="font-medium">{{ employeeName(booking.employeeId) }}</dd>
              <dt class="font-semibold text-stone-600">Termin</dt>
              <dd class="font-medium">{{ dateTime(booking.startsAt) }}</dd>
              @if (booking.payment; as payment) {
                <dt class="font-semibold text-stone-600">Zaliczka</dt>
                <dd class="font-medium">
                  {{ payment.amountCents | pricePln }}
                  {{ awaitingDeposit() ? '— do opłacenia' : '— opłacona' }}
                </dd>
              }
            </dl>

            @if (booking.payment; as payment) {
              @if (awaitingDeposit()) {
                <app-deposit-payment
                  class="block"
                  [clientSecret]="payment.clientSecret"
                  [amountCents]="payment.amountCents"
                  [expiresAt]="payment.expiresAt"
                  [returnUrl]="returnUrl()"
                  (paid)="onDepositPaid()"
                  (unavailable)="onDepositUnavailable()"
                />
              } @else {
                <p class="mt-6 text-sm text-stone-500">
                  Zaliczka została opłacona. Firma potwierdzi wizytę — status znajdziesz
                  w sekcji „Moje wizyty".
                </p>
              }
            } @else {
              <p class="mt-6 text-sm text-stone-500">
                Firma potwierdzi wizytę — status znajdziesz w sekcji „Moje wizyty".
              </p>
            }

            <!-- Podczas płatności nie zapraszamy do wyjścia; gdy formularz w ogóle nie
                 wstał, jest odwrotnie — nie ma tu już nic do zrobienia i klient musi mieć
                 czym wyjść, zamiast szukać przycisku wstecz -->
            @if (!awaitingDeposit() || depositUnavailable()) {
              <div class="mt-6 flex flex-wrap gap-3">
                <a routerLink="/client" class="btn-primary w-auto">Moje wizyty</a>
                <a
                  routerLink="../"
                  class="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  >Wróć do profilu firmy</a
                >
              </div>
            }
          </section>
        } @else {
          <a
            routerLink="../"
            class="text-sm font-medium text-brand-700 hover:underline"
            >← {{ b.name }}</a
          >
          <h1 class="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
            Rezerwacja terminu
          </h1>
          <p class="mt-1 text-sm font-medium text-stone-500" role="status">
            Krok {{ currentStep() }} z {{ totalSteps() }}
          </p>

          <section
            aria-labelledby="krok-1"
            class="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
          >
            <h2 id="krok-1" class="text-lg font-bold">1. Wybierz usługę</h2>
            @if (b.services.length) {
              <ul class="mt-4 grid gap-3 sm:grid-cols-2">
                @for (s of b.services; track s.id) {
                  <li>
                    <button
                      type="button"
                      (click)="selectService(s.id)"
                      [attr.aria-pressed]="serviceId() === s.id"
                      class="w-full rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      [class]="
                        serviceId() === s.id
                          ? 'border-brand-700 bg-brand-50'
                          : 'border-stone-200 hover:shadow-lifted'
                      "
                    >
                      <span class="block text-sm font-bold">{{ s.name }}</span>
                      <span class="mt-1 block text-[13px] text-stone-500">
                        {{ s.durationMin }} min · {{ s.priceCents | pricePln }}
                      </span>
                      <!-- AC: „kwota zaliczki widoczna przed potwierdzeniem" — już przy
                           wyborze usługi, a nie dopiero w podsumowaniu -->
                      @if (depositFor(s); as deposit) {
                        <span
                          class="mt-2 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"
                        >
                          Zaliczka {{ deposit | pricePln }} online
                        </span>
                      }
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <app-empty-state
                class="mt-4"
                title="Ta firma nie ma jeszcze aktywnych usług."
              />
            }
          </section>

          @if (selectedService(); as svc) {
            <section
              aria-labelledby="krok-2"
              class="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
            >
              <h2 id="krok-2" class="text-lg font-bold">2. Wybierz pracownika</h2>
              @if (svc.employees.length) {
                <fieldset class="mt-4">
                  <legend class="sr-only">Pracownik</legend>
                  <div class="grid gap-2">
                    <label
                      class="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium transition hover:bg-stone-50 focus-within:ring-2 focus-within:ring-brand-ring"
                    >
                      <input
                        type="radio"
                        name="employee"
                        class="accent-brand-700"
                        [checked]="employeeId() === anyEmployee"
                        (change)="selectEmployee(anyEmployee)"
                      />
                      Dowolny pracownik
                    </label>
                    @for (e of svc.employees; track e.id) {
                      <label
                        class="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium transition hover:bg-stone-50 focus-within:ring-2 focus-within:ring-brand-ring"
                      >
                        <input
                          type="radio"
                          name="employee"
                          class="accent-brand-700"
                          [checked]="employeeId() === e.id"
                          (change)="selectEmployee(e.id)"
                        />
                        {{ e.name }}
                      </label>
                    }
                  </div>
                </fieldset>
              } @else {
                <app-empty-state
                  class="mt-4"
                  title="Ta usługa nie ma jeszcze przypisanych pracowników."
                />
              }
            </section>

            @if (employeeId() && svc.employees.length) {
              <section
                aria-labelledby="krok-3"
                class="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
              >
                <h2 id="krok-3" class="text-lg font-bold">3. Wybierz termin</h2>

                @if (bookingError(); as msg) {
                  <!-- tabindex + focus: przy 409 znika całe podsumowanie razem z przyciskiem
                       trzymającym focus, więc bez tego użytkownik klawiatury ląduje w body -->
                  <p
                    #bladZapisu
                    tabindex="-1"
                    role="alert"
                    class="alert-danger mt-4 outline-none"
                  >
                    {{ msg }}
                  </p>
                }

                <label for="data" class="mb-1.5 mt-4 block text-sm font-medium"
                  >Dzień</label
                >
                <input
                  id="data"
                  type="date"
                  [value]="date()"
                  [min]="minDate"
                  (change)="selectDate($event)"
                  class="w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                />

                @if (date()) {
                  @if (slotsLoading()) {
                    <app-loading-state class="mt-4" message="Ładowanie terminów…" />
                  } @else if (slotsError(); as msg) {
                    <app-error-state
                      class="mt-4"
                      [message]="msg"
                      [retryable]="true"
                      (retry)="retrySlots()"
                    />
                  } @else if (groupedSlots().length) {
                    <ul class="mt-4 flex flex-wrap gap-2">
                      @for (slot of groupedSlots(); track slot.startsAt) {
                        <li>
                          <button
                            type="button"
                            (click)="selectSlot(slot.startsAt)"
                            [attr.aria-pressed]="selectedStart() === slot.startsAt"
                            class="rounded-lg border px-3.5 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                            [class]="
                              selectedStart() === slot.startsAt
                                ? 'border-brand-700 bg-brand-700 text-white'
                                : 'border-stone-300 hover:bg-stone-50'
                            "
                          >
                            {{ time(slot.startsAt) }}
                          </button>
                        </li>
                      }
                    </ul>
                  } @else {
                    <app-empty-state
                      class="mt-4"
                      title="Brak wolnych terminów w tym dniu."
                    />
                  }
                }
              </section>
            }

            @if (selectedSlot(); as slot) {
              <section
                aria-labelledby="podsumowanie"
                class="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
              >
                <h2 id="podsumowanie" class="text-lg font-bold">Podsumowanie</h2>
                <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
                  <dt class="font-semibold text-stone-600">Usługa</dt>
                  <dd class="font-medium">
                    {{ svc.name }} ({{ svc.durationMin }} min)
                  </dd>
                  <dt class="font-semibold text-stone-600">Pracownik</dt>
                  <dd class="font-medium">{{ employeeName(slot.employeeId) }}</dd>
                  <dt class="font-semibold text-stone-600">Termin</dt>
                  <dd class="font-medium">{{ dateTime(slot.startsAt) }}</dd>
                  <dt class="font-semibold text-stone-600">Cena</dt>
                  <dd class="font-medium">{{ svc.priceCents | pricePln }}</dd>
                  @if (depositCents(); as deposit) {
                    <dt class="font-semibold text-stone-600">Zaliczka (online)</dt>
                    <dd class="font-medium">{{ deposit | pricePln }}</dd>
                    <dt class="font-semibold text-stone-600">Do zapłaty na miejscu</dt>
                    <dd class="font-medium">
                      {{ svc.priceCents - deposit | pricePln }}
                    </dd>
                  }
                </dl>

                @if (depositCents()) {
                  <p class="mt-4 text-[13px] leading-relaxed text-stone-500">
                    Ta usługa wymaga zaliczki. Po kliknięciu przycisku przejdziesz do
                    płatności — termin czeka zarezerwowany przez 15 minut.
                  </p>
                }

                <label for="notatka" class="mb-1.5 mt-5 block text-sm font-medium"
                  >Notatka dla firmy (opcjonalnie)</label
                >
                <textarea
                  id="notatka"
                  rows="3"
                  maxlength="500"
                  aria-describedby="notatka-licznik"
                  [value]="clientNote()"
                  (input)="onNoteInput($event)"
                  class="w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm shadow-card transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-ring"
                ></textarea>
                <p id="notatka-licznik" class="mt-1 text-[13px] text-stone-500">
                  {{ clientNote().length }} / 500 znaków
                </p>

                @if (!isLoggedIn()) {
                  <p class="mt-4 text-sm text-stone-500">
                    Dokończenie rezerwacji wymaga zalogowania. Przeniesiemy Cię na
                    stronę logowania i wrócisz tutaj z zachowanym wyborem.
                  </p>
                }

                <button
                  type="button"
                  [disabled]="submitting()"
                  (click)="onSubmit()"
                  class="btn-primary mt-5"
                >
                  {{ submitLabel() }}
                </button>
              </section>
            }
          }
        }
      </div>
    }
  `,
})
export default class BookingWizard {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stripeLoader = inject(StripeLoader);

  protected readonly anyEmployee = ANY_EMPLOYEE;
  protected readonly minDate = todayInBusinessTz();
  protected readonly time = formatTime;
  protected readonly dateTime = formatDateTime;
  protected readonly isLoggedIn = this.auth.isLoggedIn;

  private readonly slug = signal('');
  private slotsRequestId = 0;

  protected readonly business = signal<PublicBusiness | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly serverError = signal<string | null>(null);

  // stan wizarda; „null" pracownika = krok 2 jeszcze nierozstrzygnięty (ANY_EMPLOYEE to
  // świadomy wybór, nie brak wyboru)
  protected readonly serviceId = signal<string | null>(null);
  protected readonly employeeId = signal<string | null>(null);
  protected readonly date = signal('');
  protected readonly selectedStart = signal<string | null>(null);
  protected readonly clientNote = signal('');

  protected readonly slots = signal<AvailableSlot[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly slotsError = signal<string | null>(null);

  protected readonly submitting = signal(false);
  protected readonly bookingError = signal<string | null>(null);
  protected readonly createdBooking = signal<Booking | null>(null);
  // zaliczka opłacona w tej sesji kreatora; osobno od createdBooking, bo status samej
  // rezerwacji nie zmienia się od razu — potwierdzenie przychodzi webhookiem (#51)
  protected readonly depositPaid = signal(false);
  // wynik płatności, która wyszła poza stronę (BLIK, Przelewy24) — po powrocie nie ma już
  // ani createdBooking, ani client_secret w pamięci, więc to osobna ścieżka widoku.
  // `unknown` = nie udało się dopytać Stripe'a; to nie to samo co `failed` (patrz niżej).
  protected readonly redirectedPayment = signal<
    'paid' | 'failed' | 'unknown' | null
  >(null);
  // Payment Element nie wstał (zablokowany skrypt, brak kluczy) — rezerwacji nie da się już
  // opłacić, więc klient musi mieć czym wyjść z tego ekranu
  protected readonly depositUnavailable = signal(false);

  protected readonly selectedService = computed(
    () => this.business()?.services.find((s) => s.id === this.serviceId()) ?? null,
  );

  /** Kwota zaliczki dla usługi albo null. Ta sama reguła zaokrąglania co na backendzie —
   *  inaczej kwota na ekranie różniłaby się o grosz od kwoty pobranej przez Stripe. */
  protected depositFor(service: {
    depositType: DepositType | null;
    depositValue: number | null;
    priceCents: number;
  }): number | null {
    return depositAmountCents(service);
  }

  protected readonly depositCents = computed(() => {
    const service = this.selectedService();
    return service ? depositAmountCents(service) : null;
  });

  /** Usługa z zaliczką dokłada krok płatności — licznik kroków ma to odzwierciedlać. */
  protected readonly totalSteps = computed(() => (this.depositCents() ? 4 : 3));

  /** Rezerwacja stoi na kroku płatności: zaliczka jest, a jeszcze nie została opłacona. */
  protected readonly awaitingDeposit = computed(
    () => this.createdBooking()?.payment != null && !this.depositPaid(),
  );

  protected readonly groupedSlots = computed(() => groupSlotsByStart(this.slots()));

  protected readonly selectedSlot = computed(() => {
    const start = this.selectedStart();
    return start
      ? (this.groupedSlots().find((s) => s.startsAt === start) ?? null)
      : null;
  });

  // selectedService(), nie serviceId() — id z adresu może nie wskazywać na żadną usługę
  // tej firmy, a wtedy na ekranie i tak widać dopiero krok 1
  protected readonly currentStep = computed(() => {
    if (!this.selectedService()) return 1;
    if (!this.employeeId()) return 2;
    return 3;
  });

  private readonly confirmationHeading =
    viewChild<ElementRef<HTMLHeadingElement>>('potwierdzenie');
  private readonly bookingErrorAlert =
    viewChild<ElementRef<HTMLParagraphElement>>('bladZapisu');

  protected readonly submitLabel = computed(() => {
    if (this.submitting()) return 'Rezerwuję…';
    if (!this.isLoggedIn()) return 'Zaloguj się i zarezerwuj';
    return this.depositCents() ? 'Zarezerwuj i zapłać zaliczkę' : 'Rezerwuj';
  });

  /** Adres powrotu dla metod płatności z przekierowaniem — bezwzględny, bo trafia do Stripe'a. */
  protected readonly returnUrl = computed(
    () => globalThis.location.origin + this.wizardUrl(),
  );

  protected onDepositPaid(): void {
    this.depositPaid.set(true);
  }

  protected onDepositUnavailable(): void {
    this.depositUnavailable.set(true);
  }

  protected redirectHeading(result: 'paid' | 'failed' | 'unknown'): string {
    if (result === 'paid') return 'Zaliczka opłacona';
    return result === 'failed'
      ? 'Płatność niedokończona'
      : 'Nie znamy statusu płatności';
  }

  constructor() {
    effect(() => this.confirmationHeading()?.nativeElement.focus());
    effect(() => this.bookingErrorAlert()?.nativeElement.focus());

    // stan odtwarzany z adresu — dzięki temu powrót z /login?returnUrl=… wraca dokładnie
    // do tego samego kroku wizarda
    const query = this.route.snapshot.queryParamMap;
    this.serviceId.set(query.get('serviceId'));
    this.employeeId.set(query.get('employeeId'));
    this.date.set(query.get('date') ?? '');
    this.selectedStart.set(query.get('startsAt'));
    this.clientNote.set(query.get('clientNote') ?? '');

    // Powrót z metody płatności, która wymagała przekierowania (BLIK, Przelewy24). Stripe
    // dokleja te parametry do `return_url`; bez tej gałęzi klient wracałby na krok 3
    // z terminem zajętym przez własną rezerwację i bez słowa o tym, czy zapłacił.
    const secret = query.get('payment_intent_client_secret');
    if (secret) {
      void this.resolveRedirectedPayment(secret);
    }

    // slug siedzi w trasie rodzica (':slug' → dziecko 'rezerwacja'); paramMap, nie snapshot,
    // bo Angular reużywa instancję komponentu między dwoma sluga
    (this.route.parent?.paramMap ?? this.route.paramMap)
      .pipe(takeUntilDestroyed())
      .subscribe((pm) => this.load(pm.get('slug') ?? ''));
  }

  /**
   * Stan płatności odczytany po powrocie z przekierowania — źródłem prawdy jest Stripe,
   * nie parametr `redirect_status` w adresie, który da się dopisać ręcznie.
   *
   * `unknown` jest osobnym stanem, a nie odmianą `failed`: zablokowany skrypt Stripe'a albo
   * chwilowy błąd sieci znaczy tyle, że nie wiemy, a nie że pieniądze nie wyszły. Powiedzenie
   * komuś, kto właśnie zapłacił BLIK-iem, że zaliczka nie wpłynęła, wypycha go w drugą
   * płatność za tę samą wizytę.
   */
  private async resolveRedirectedPayment(clientSecret: string): Promise<void> {
    try {
      const stripe = await this.stripeLoader.load();
      if (!stripe) {
        this.redirectedPayment.set('unknown');
        return;
      }
      const { paymentIntent, error } =
        await stripe.retrievePaymentIntent(clientSecret);
      if (error || !paymentIntent) {
        this.redirectedPayment.set('unknown');
        return;
      }
      this.redirectedPayment.set(
        paymentIntent.status === 'succeeded' ||
          paymentIntent.status === 'processing'
          ? 'paid'
          : 'failed',
      );
    } catch {
      this.redirectedPayment.set('unknown');
    }
  }

  /** Odtworzony z adresu wybór mógł się zdezaktualizować (usługa wyłączona, pracownik
   *  odpięty od usługi) — bez tego wizard pokazuje krok 3 bez zaznaczonego pracownika
   *  i wysyła zapytanie o sloty, które backend odrzuca. */
  private reconcileRestoredState(): void {
    const service = this.selectedService();
    if (this.serviceId() && !service) {
      this.serviceId.set(null);
      this.employeeId.set(null);
      this.clearSlots();
      this.syncUrl();
      return;
    }

    const employeeId = this.employeeId();
    const known =
      employeeId === ANY_EMPLOYEE ||
      service?.employees.some((e) => e.id === employeeId) === true;
    if (employeeId && !known) {
      this.employeeId.set(null);
      this.clearSlots();
      this.syncUrl();
    }
  }

  protected employeeName(employeeId: string): string {
    const employee = this.selectedService()?.employees.find(
      (e) => e.id === employeeId,
    );
    return employee?.name ?? 'Pracownik';
  }

  protected selectService(serviceId: string): void {
    if (this.serviceId() === serviceId) return;
    this.serviceId.set(serviceId);
    // inna usługa to inni pracownicy i inna długość wizyty — wybór z kroków 2-3 nieaktualny.
    // Datę zostawiamy: dzień jest niezależny od usługi, a przepisywanie go irytuje.
    this.employeeId.set(null);
    this.clearSlots();
    this.syncUrl();
  }

  protected selectEmployee(employeeId: string): void {
    if (this.employeeId() === employeeId) return;
    this.employeeId.set(employeeId);
    this.clearSlots();
    this.syncUrl();
    if (this.date()) {
      void this.loadSlots();
    }
  }

  protected selectDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.date() === value) return;
    this.date.set(value);
    this.clearSlots();
    this.syncUrl();
    if (value) {
      void this.loadSlots();
    }
  }

  protected selectSlot(startsAt: string): void {
    this.selectedStart.set(startsAt);
    this.bookingError.set(null);
    this.syncUrl();
  }

  protected onNoteInput(event: Event): void {
    this.clientNote.set((event.target as HTMLTextAreaElement).value);
  }

  /** Ponowienie po nieudanym pobraniu profilu firmy — slug trzymamy w sygnale, więc
   *  nie potrzebujemy nawigacji ani przeładowania strony. */
  protected retry(): void {
    this.load(this.slug());
  }

  protected retrySlots(): void {
    void this.loadSlots();
  }

  protected async onSubmit(): Promise<void> {
    const slot = this.selectedSlot();
    const serviceId = this.serviceId();
    if (!slot || !serviceId || this.submitting()) return;

    if (!this.isLoggedIn()) {
      // finalizacja wymaga tokena — na login z celem powrotu, a nie z pustym POST-em w 401
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: this.wizardUrl() },
      });
      return;
    }

    this.submitting.set(true);
    this.bookingError.set(null);
    const note = this.clientNote().trim();
    try {
      const booking = await firstValueFrom(
        this.api.post<Booking>('/bookings', {
          serviceId,
          // przy „dowolnym" pracownika wyznacza wybrany slot — POST /bookings wymaga konkretnego
          employeeId: slot.employeeId,
          startsAt: slot.startsAt,
          ...(note && { clientNote: note }),
        }),
      );
      this.createdBooking.set(booking);
    } catch (err) {
      this.bookingError.set(apiErrorMessage(err));
      if (err instanceof HttpErrorResponse && err.status === 409) {
        // ktoś zajął termin w międzyczasie — lista slotów jest nieaktualna
        this.selectedStart.set(null);
        this.syncUrl();
        await this.loadSlots();
      }
    } finally {
      this.submitting.set(false);
    }
  }

  private clearSlots(): void {
    this.slots.set([]);
    this.slotsError.set(null);
    this.selectedStart.set(null);
    // błąd zapisu dotyczył konkretnego terminu — po zmianie dnia/usługi/pracownika
    // wisiałby nad świeżą, poprawną listą slotów
    this.bookingError.set(null);
  }

  private load(slug: string): void {
    this.slug.set(slug);
    this.loading.set(true);
    this.notFound.set(false);
    this.serverError.set(null);
    firstValueFrom(this.api.get<PublicBusiness>('/businesses/' + slug))
      .then((b) => {
        this.business.set(b);
        // dopiero teraz wiadomo, czy wybór z adresu jest jeszcze aktualny — sloty
        // ładujemy po weryfikacji, żeby nie strzelać zapytaniem z martwym employeeId
        this.reconcileRestoredState();
        if (this.serviceId() && this.employeeId() && this.date()) {
          void this.loadSlots();
        }
      })
      .catch((err) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.notFound.set(true);
        } else {
          this.serverError.set(apiErrorMessage(err));
        }
      })
      .finally(() => this.loading.set(false));
  }

  private async loadSlots(): Promise<void> {
    const serviceId = this.serviceId();
    const employeeId = this.employeeId();
    const date = this.date();
    if (!serviceId || !employeeId || !date) return;

    // szybkie przeklikiwanie dni zostawia kilka requestów w locie; liczy się wyłącznie
    // odpowiedź na ostatni, inaczej wolniejszy starszy request nadpisałby świeże sloty
    const request = ++this.slotsRequestId;

    this.slotsLoading.set(true);
    this.slotsError.set(null);
    const query = new URLSearchParams({ serviceId, date });
    if (employeeId !== ANY_EMPLOYEE) {
      query.set('employeeId', employeeId);
    }
    try {
      const slots = await firstValueFrom(
        this.api.get<AvailableSlot[]>(
          `/businesses/${this.slug()}/availability?${query}`,
        ),
      );
      if (request !== this.slotsRequestId) return;
      this.slots.set(slots);
      // termin odtworzony z adresu (albo sprzed konfliktu) mógł już zniknąć z listy
      const start = this.selectedStart();
      if (start && !slots.some((s) => s.startsAt === start)) {
        this.selectedStart.set(null);
        this.syncUrl();
      }
    } catch (err) {
      if (request !== this.slotsRequestId) return;
      this.slots.set([]);
      this.slotsError.set(apiErrorMessage(err));
    } finally {
      if (request === this.slotsRequestId) {
        this.slotsLoading.set(false);
      }
    }
  }

  /** Adres wizarda z aktualnym wyborem — cel powrotu po zalogowaniu. */
  private wizardUrl(): string {
    return this.router
      .createUrlTree(['/', this.slug(), 'rezerwacja'], {
        queryParams: this.queryParams(),
      })
      .toString();
  }

  private queryParams(): Record<string, string | null> {
    return {
      serviceId: this.serviceId(),
      employeeId: this.employeeId(),
      date: this.date() || null,
      startsAt: this.selectedStart(),
      // notatka też wraca z logowania — obiecuje to komunikat nad przyciskiem
      clientNote: this.clientNote() || null,
    };
  }

  /** Adres jest źródłem prawdy o stanie wizarda; replaceUrl, żeby każdy klik nie zaśmiecał historii. */
  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.queryParams(),
      replaceUrl: true,
    });
  }
}
