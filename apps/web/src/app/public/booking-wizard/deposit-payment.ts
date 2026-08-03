import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import { StripeLoader } from '../../shared/payments/stripe-loader';
import { PricePlnPipe } from '../../shared/price-pln.pipe';

/** Ile zostało do wygaśnięcia rezerwacji, w pełnych sekundach (0 = już po). */
export function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

/** „12:05" — odliczanie ma się czytać jak zegar, nie jak surowa liczba sekund. */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Krok 4 kreatora (#53) — opłacenie zaliczki Payment Elementem, bez wychodzenia z rezerwacji.
 *
 * Komponent dostaje gotowy `client_secret` z odpowiedzi na `POST /bookings` i trzyma go
 * wyłącznie w pamięci: po odrzuconej karcie PaymentIntent wraca do `requires_payment_method`,
 * więc kolejna próba idzie tym samym sekretem i nie potrzebuje niczego od backendu. Dlatego
 * przy błędzie przycisk wraca do stanu aktywnego zamiast znikać — to jest całe „ponowienie
 * w oknie ważności rezerwacji" z kryteriów akceptacji.
 *
 * Okna ważności nie liczymy sami: `expiresAt` wystawia backend z `paymentDeadline()`, tego
 * samego, po którym cron kasuje nieopłacone rezerwacje. Front tylko odlicza, żeby nie
 * rozjechać się z serwerem.
 */
@Component({
  selector: 'app-deposit-payment',
  imports: [PricePlnPipe],
  template: `
    <section
      aria-labelledby="krok-platnosc"
      class="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-card"
    >
      <!-- focus wędruje tu z przycisku „Zarezerwuj…", który zniknął razem z podsumowaniem —
           bez tego użytkownik czytnika ekranu zostaje bez kontekstu (WCAG 2.4.3) -->
      <h2
        #naglowek
        id="krok-platnosc"
        tabindex="-1"
        class="text-lg font-bold outline-none"
      >
        4. Zapłać zaliczkę
      </h2>

      <p class="mt-2 text-sm leading-relaxed text-stone-600">
        Termin jest już zarezerwowany. Zachowasz go, opłacając zaliczkę
        <strong class="font-semibold">{{ amountCents() | pricePln }}</strong
        >; resztę zapłacisz na miejscu.
      </p>

      @if (expired()) {
        <p role="alert" class="alert-danger mt-4">
          Czas na opłacenie zaliczki minął — rezerwacja wygasła, a termin wrócił do puli
          wolnych. Wybierz go jeszcze raz, jeśli nadal jest dostępny.
        </p>
      } @else {
        <p class="mt-4 text-sm font-medium text-stone-500">
          Termin czeka na płatność jeszcze
          <span class="font-bold tabular-nums text-stone-800">{{ countdown() }}</span>
          min.
        </p>
      }

      @if (loadError()) {
        <!-- Bez „odśwież stronę": client_secret żyje wyłącznie w pamięci tej instancji,
             więc przeładowanie odbiera jedyną możliwość zapłaty zamiast ją przywracać -->
        <p role="alert" class="alert-danger mt-4">
          Nie udało się załadować formularza płatności, a bez niego nie opłacisz tej
          rezerwacji — termin zwolni się po upływie odliczania. Spróbuj zarezerwować go
          ponownie, najlepiej bez blokera treści albo w innej przeglądarce.
        </p>
      }

      <!-- Payment Element montuje się w tym kontenerze, więc musi istnieć w drzewie już
           w chwili mount(); do tego czasu jest tylko schowany -->
      <div #kontener class="mt-5" [class.hidden]="!ready()"></div>

      @if (!ready() && !loadError()) {
        <p class="mt-5 text-sm text-stone-500">Ładowanie formularza płatności…</p>
      }

      @if (payError(); as msg) {
        <!-- tabindex + focus: po odrzuconej karcie użytkownik klawiatury ma wylądować na
             komunikacie, a nie zgadywać, dlaczego nic się nie stało -->
        <p
          #bladPlatnosci
          tabindex="-1"
          role="alert"
          class="alert-danger mt-4 outline-none"
        >
          {{ msg }}
        </p>
      }

      @if (ready() && !expired()) {
        <button
          type="button"
          [disabled]="submitting()"
          (click)="pay()"
          class="btn-primary mt-5"
        >
          @if (submitting()) {
            Przetwarzam płatność…
          } @else {
            Zapłać {{ amountCents() | pricePln }}
          }
        </button>
      }
    </section>
  `,
})
export default class DepositPayment {
  private readonly stripeLoader = inject(StripeLoader);
  private readonly destroyRef = inject(DestroyRef);

  /** Jednorazowe poświadczenie do zapłaty z odpowiedzi na `POST /bookings`. */
  readonly clientSecret = input.required<string>();
  readonly amountCents = input.required<number>();
  /** ISO 8601 — `paymentDeadline()` z backendu, koniec okna na opłacenie. */
  readonly expiresAt = input.required<string>();
  /**
   * Dokąd wróci klient, jeśli wybierze metodę wymagającą przekierowania (BLIK, Przelewy24).
   * Intent powstaje z `automatic_payment_methods`, więc takie metody mogą się w Payment
   * Elemencie pojawić, a bez adresu powrotu Stripe odmówiłby potwierdzenia płatności.
   */
  readonly returnUrl = input.required<string>();

  readonly paid = output<void>();
  /** Formularz w ogóle nie wstał — rodzic ma wtedy pokazać wyjście z ekranu płatności. */
  readonly unavailable = output<void>();

  private readonly container =
    viewChild<ElementRef<HTMLDivElement>>('kontener');
  private readonly heading =
    viewChild<ElementRef<HTMLHeadingElement>>('naglowek');
  private readonly errorAlert =
    viewChild<ElementRef<HTMLParagraphElement>>('bladPlatnosci');

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;

  protected readonly ready = signal(false);
  protected readonly loadError = signal(false);
  protected readonly submitting = signal(false);
  protected readonly payError = signal<string | null>(null);

  // zegar tyka w sygnale, żeby odliczanie było zwykłym computed(), a nie ręcznym
  // odświeżaniem widoku
  private readonly now = signal(Date.now());

  private readonly remaining = computed(() =>
    secondsUntil(this.expiresAt(), this.now()),
  );
  protected readonly countdown = computed(() =>
    formatCountdown(this.remaining()),
  );
  protected readonly expired = computed(() => this.remaining() === 0);

  constructor() {
    effect(() => this.heading()?.nativeElement.focus());
    effect(() => this.errorAlert()?.nativeElement.focus());

    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.elements = null;
    });

    void this.mount();
  }

  private async mount(): Promise<void> {
    const stripe = await this.stripeLoader.load();
    const container = this.container()?.nativeElement;
    if (!stripe || !container) {
      // brak kluczy w środowisku albo zablokowany skrypt Stripe'a — jedno i drugie znaczy
      // dla klienta to samo: formularza nie będzie
      this.loadError.set(true);
      this.unavailable.emit();
      return;
    }

    this.stripe = stripe;
    this.elements = stripe.elements({
      clientSecret: this.clientSecret(),
      // ten sam pomarańcz akcentu i promień rogów co reszta formularzy z design systemu,
      // żeby ramka Stripe'a nie wyglądała jak wklejona z innej aplikacji
      appearance: {
        variables: {
          colorPrimary: '#c2410c',
          colorDanger: '#e11d48',
          fontFamily: 'inherit',
          borderRadius: '0.5rem',
        },
      },
    });
    this.elements.create('payment').mount(container);
    this.ready.set(true);
  }

  protected async pay(): Promise<void> {
    const stripe = this.stripe;
    const elements = this.elements;
    if (!stripe || !elements || this.submitting() || this.expired()) return;

    this.submitting.set(true);
    this.payError.set(null);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: this.returnUrl() },
        // karta zostaje w kreatorze („płatność w wizardzie bez wychodzenia z flow");
        // przekierowanie zdarza się wyłącznie przy metodach, które inaczej nie działają
        redirect: 'if_required',
      });

      if (error) {
        // Stripe podaje `error.message` w języku przeglądarki i konkretniej, niż umiemy
        // zgadnąć („odmowa banku", „zły kod CVC") — własny komunikat zostaje na wypadek,
        // gdy SDK nie ma nic do powiedzenia
        this.payError.set(
          error.message ?? 'Nie udało się pobrać zaliczki — spróbuj ponownie.',
        );
        return;
      }

      // `processing` (BLIK, przelew) jest dla kreatora sukcesem tak samo jak `succeeded`:
      // rezerwacja nie czeka już na klienta, a wynik dojdzie webhookiem
      if (
        paymentIntent?.status === 'succeeded' ||
        paymentIntent?.status === 'processing'
      ) {
        this.paid.emit();
        return;
      }

      this.payError.set(
        'Płatność nie została zakończona — spróbuj ponownie lub wybierz inną metodę.',
      );
    } catch {
      this.payError.set(
        'Nie udało się połączyć z operatorem płatności — spróbuj ponownie.',
      );
    } finally {
      // przycisk wraca do gry: ten sam client_secret obsłuży kolejną próbę
      this.submitting.set(false);
    }
  }
}
