import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/**
 * Webhook Stripe'a (#51) — jedyna publiczna trasa backendu bez JwtAuthGuard. Uwierzytelnieniem
 * jest podpis w nagłówku `stripe-signature`, bo Stripe nie ma tokena naszej aplikacji; bez
 * weryfikacji podpisu każdy mógłby POST-em oznaczyć dowolną rezerwację jako opłaconą.
 *
 * Bez throttlera, choć trasa jest publiczna: ograniczanie ponowień Stripe'a działałoby
 * przeciwko nam — retry jest tu mechanizmem dostarczania, nie nadużyciem.
 *
 * Ścieżka `POST /api/payments/webhook` jest kontraktem z README (#50) — to na nią kieruje
 * `stripe listen --forward-to`.
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Konfiguracja płatności dla przeglądarki (#53). Bez guarda i celowo — kreator rezerwacji
   * ładuje Stripe.js zanim ktokolwiek się zaloguje, a `pk_*` jest kluczem publicznym.
   *
   * `null` znaczy „płatności online wyłączone w tym środowisku" (tak stoi lokalny setup i CI
   * wg README) — front ma wtedy nie montować Payment Elementu zamiast pokazywać pusty
   * formularz. Rozróżnienie robi się po wartości, nie po 404: brak konfiguracji jest
   * poprawnym stanem, nie błędem.
   */
  @Get('config')
  config() {
    return { publishableKey: this.stripe.publishableKey };
  }

  /**
   * 200 zamiast domyślnego dla POST 201: Stripe czyta wyłącznie kod, a 2xx znaczy
   * „dostarczone, nie ponawiaj". Każdy wyjątek stąd (400 zły podpis, 503 brak sekretu,
   * 500 błąd bazy) wychodzi spoza 2xx, więc zdarzenie wróci przy kolejnym ponowieniu —
   * i dlatego handler musi być idempotentny.
   *
   * Celowo bez @Body(): weryfikacja podpisu potrzebuje surowych bajtów (`rawBody` z main.ts),
   * a przy okazji globalny ValidationPipe z `forbidNonWhitelisted` nie ma tu czego odrzucić.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const event = this.stripe.constructEvent(req.rawBody, signature);
    await this.payments.handleEvent(event);
    return { received: true };
  }
}
