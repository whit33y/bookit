import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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
}
