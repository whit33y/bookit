import { Service, inject } from '@angular/core';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api-client';

/** Odpowiedź `GET /api/payments/config` (#53) — lustro `PaymentsController.config`. */
interface PaymentsConfig {
  /** `null` = płatności online wyłączone w tym środowisku (brak kluczy w apps/api/.env). */
  publishableKey: string | null;
}

/**
 * Jedyne miejsce frontu, które dotyka Stripe.js — odpowiednik `StripeService` po stronie
 * backendu. Reszta aplikacji dostaje gotowy obiekt `Stripe` albo `null` i nie wie ani skąd
 * bierze się klucz, ani że gdzieś doczytuje się skrypt z `js.stripe.com`.
 *
 * Klucz idzie z backendu, a nie z pliku środowiskowego: `apps/web` nie ma `environment.ts`,
 * a README (#50) trzyma wszystkie `STRIPE_*` w `apps/api/.env`. Dzięki temu podmiana kluczy
 * to restart backendu, nie przebudowa bundle'a.
 *
 * Wydzielenie ma też drugi powód: specki nadpisują ten provider atrapą, więc jsdom nigdy nie
 * próbuje pobrać skryptu Stripe'a — z prawdziwym `loadStripe` żaden test płatności nie
 * doczekałby się rozwiązania promisy.
 */
@Service()
export class StripeLoader {
  private readonly api = inject(ApiClient);

  // `loadStripe` wstrzykuje <script> do <head> — bez memoizacji każdy komponent płatności
  // dokładałby kolejny tag i kolejne pytanie o konfigurację
  private cached: Promise<Stripe | null> | null = null;

  /** Gotowy `Stripe` albo `null`, gdy w tym środowisku nie ma skonfigurowanych płatności. */
  load(): Promise<Stripe | null> {
    this.cached ??= this.fetch();
    return this.cached;
  }

  private async fetch(): Promise<Stripe | null> {
    try {
      const { publishableKey } = await firstValueFrom(
        this.api.get<PaymentsConfig>('/payments/config'),
      );
      return publishableKey ? await loadStripe(publishableKey) : null;
    } catch {
      // Nieudane pobranie konfiguracji albo zablokowany skrypt Stripe'a wygląda dla
      // wołającego tak samo jak wyłączone płatności — komunikat dla klienta układa
      // komponent, który wie, w którym kroku rezerwacji stoi.
      this.cached = null;
      return null;
    }
  }
}
