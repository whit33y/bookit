import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Jedyne miejsce w backendzie, które wie o SDK Stripe'a — PaymentIntenty (#51), refundy (#52)
 * i weryfikacja podpisu webhooka idą przez tego klienta.
 *
 * Klient powstaje leniwie, a nie w konstruktorze jak MailService ze SMTP_*: brak kluczy Stripe
 * nie może zatrzymać startu backendu, bo usługi bez zaliczki mają działać po staremu (#51),
 * a lokalny setup i CI kręcą się bez konta Stripe. Cena tej decyzji to 503 zamiast błędu
 * przy starcie, gdy ktoś włączy zaliczkę bez skonfigurowanych kluczy.
 *
 * `apiVersion` celowo nieustawione — bierzemy wersję przypiętą w SDK, żeby aktualizacja
 * biblioteki i wersji API szły razem, jednym bumpem zależności.
 */
@Injectable()
export class StripeService {
  private cached: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Czy w tym środowisku płatności online są w ogóle włączone — po tym rozgałęzia się #51. */
  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('STRIPE_SECRET_KEY'));
  }

  /**
   * Klucz `pk_*` dla Stripe.js w przeglądarce (#53) albo null, gdy płatności w tym
   * środowisku nie działają. Jawność klucza jest zamierzona — publishable key służy
   * wyłącznie do tokenizacji danych karty i Stripe publikuje go we własnej dokumentacji;
   * sekret zostaje po tej stronie i nigdy nie wychodzi z tego pliku.
   *
   * Warunek na `isConfigured`, a nie na sam publishable: bez `STRIPE_SECRET_KEY` żaden
   * PaymentIntent i tak nie powstanie, więc oddanie klucza pokazałoby klientowi Payment
   * Element, który nie ma czego potwierdzić.
   */
  get publishableKey(): string | null {
    if (!this.isConfigured) {
      return null;
    }
    return this.config.get<string>('STRIPE_PUBLISHABLE_KEY') || null;
  }

  get client(): Stripe {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Płatności online są chwilowo niedostępne',
      );
    }
    // memoizacja: Stripe trzyma w kliencie pulę połączeń, więc nowa instancja na żądanie
    // gubiłaby keep-alive
    this.cached ??= new Stripe(secretKey);
    return this.cached;
  }

  /**
   * Zweryfikowane zdarzenie webhooka (#51) albo wyjątek. Uwierzytelnieniem trasy
   * `POST /api/payments/webhook` jest wyłącznie ten podpis — Stripe nie ma tokena JWT,
   * więc bez tej metody endpoint przyjmowałby dowolny JSON od kogokolwiek.
   *
   * `payload` musi być **surowymi bajtami** żądania: HMAC liczy się ze znaków sprzed
   * parsowania, więc `JSON.stringify(req.body)` nie przejdzie weryfikacji (kolejność kluczy
   * i białe znaki). Stąd `rawBody: true` w main.ts.
   *
   * Rozróżnienie kodów jest celowe: 503 to nasza niedokonfigurowana instancja (pusty
   * `STRIPE_WEBHOOK_SECRET`), 400 to niepoprawne żądanie. Oba są spoza 2xx, więc Stripe
   * i tak ponowi dostarczenie — a lokalnie 400 jest zwykłym objawem nieodświeżonego
   * sekretu po restarcie `stripe listen`.
   */
  constructEvent(
    payload: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'Płatności online są chwilowo niedostępne',
      );
    }
    if (!payload || !signature) {
      throw new BadRequestException('Brak podpisu zdarzenia Stripe');
    }

    try {
      return this.client.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    } catch {
      // Treść błędu z SDK nie idzie dalej: przy sfałszowanym żądaniu nie ma po co
      // podpowiadać nadawcy, co dokładnie się nie zgadza.
      throw new BadRequestException('Nieprawidłowy podpis zdarzenia Stripe');
    }
  }
}
