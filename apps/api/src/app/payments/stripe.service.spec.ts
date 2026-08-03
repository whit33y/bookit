import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeService } from './stripe.service';

// Atrapa ConfigService, nie `new ConfigService(env)` jak w guards.spec.ts: prawdziwy
// ConfigService dla brakującego klucza schodzi do process.env, a Nx wciąga apps/api/.env,
// więc test „brak klucza" przechodziłby albo nie zależnie od lokalnego .env dewelopera.
const withEnv = (env: Record<string, string>) =>
  new StripeService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);

describe('StripeService', () => {
  it('brak STRIPE_SECRET_KEY → isConfigured false', () => {
    expect(withEnv({}).isConfigured).toBe(false);
  });

  it('pusty STRIPE_SECRET_KEY traktujemy jak brak (tak wygląda świeży .env)', () => {
    expect(withEnv({ STRIPE_SECRET_KEY: '' }).isConfigured).toBe(false);
  });

  it('klucz ustawiony → isConfigured true', () => {
    expect(withEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }).isConfigured).toBe(true);
  });

  // #53: klucz publishable jedzie do przeglądarki, więc `null` musi znaczyć dokładnie
  // „nie montuj Payment Elementu", a nie „spróbuj z pustym stringiem"
  describe('publishableKey', () => {
    it('komplet kluczy → klucz publishable', () => {
      const service = withEnv({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
      });

      expect(service.publishableKey).toBe('pk_test_x');
    });

    it('pusty STRIPE_PUBLISHABLE_KEY → null, nie pusty string', () => {
      const service = withEnv({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_PUBLISHABLE_KEY: '',
      });

      expect(service.publishableKey).toBeNull();
    });

    // sam publishable bez sekretu to instancja, w której nie powstanie żaden PaymentIntent —
    // oddanie klucza pokazałoby klientowi formularz, którego nie ma czym potwierdzić
    it('brak STRIPE_SECRET_KEY → null, choć publishable jest ustawiony', () => {
      const service = withEnv({ STRIPE_PUBLISHABLE_KEY: 'pk_test_x' });

      expect(service.publishableKey).toBeNull();
    });
  });

  // brak kluczy nie może wywalić startu backendu, więc błąd pojawia się dopiero przy użyciu
  it('brak klucza → sięgnięcie po klienta daje 503, nie błąd przy starcie', () => {
    expect(() => withEnv({}).client).toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });

  it('klient jest memoizowany — Stripe trzyma w nim pulę połączeń', () => {
    const service = withEnv({ STRIPE_SECRET_KEY: 'sk_test_x' });
    expect(service.client).toBe(service.client);
  });

  // AC #51: „Webhook z weryfikacją podpisu". Podpisy liczymy prawdziwym SDK
  // (generateTestHeaderString działa offline), więc test sprawdza realną weryfikację,
  // a nie atrapę zwracającą true.
  describe('constructEvent', () => {
    const WEBHOOK_SECRET = 'whsec_testtesttesttesttesttest';
    const PAYLOAD = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    });

    const configured = () =>
      withEnv({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      });

    const sign = (payload: string, secret = WEBHOOK_SECRET) =>
      new Stripe('sk_test_x').webhooks.generateTestHeaderString({
        payload,
        secret,
      });

    it('poprawnie podpisane zdarzenie przechodzi', () => {
      const event = configured().constructEvent(
        Buffer.from(PAYLOAD),
        sign(PAYLOAD),
      );

      expect(event.id).toBe('evt_1');
      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('brak STRIPE_WEBHOOK_SECRET → 503, tak jak brak klucza przy kliencie', () => {
      const service = withEnv({ STRIPE_SECRET_KEY: 'sk_test_x' });

      expect(() =>
        service.constructEvent(Buffer.from(PAYLOAD), sign(PAYLOAD)),
      ).toThrowError(expect.objectContaining({ status: 503 }));
    });

    it('brak nagłówka stripe-signature → 400', () => {
      expect(() =>
        configured().constructEvent(Buffer.from(PAYLOAD), undefined),
      ).toThrowError(expect.objectContaining({ status: 400 }));
    });

    it('brak rawBody (niewłączone w main.ts) → 400, nie 500', () => {
      expect(() =>
        configured().constructEvent(undefined, sign(PAYLOAD)),
      ).toThrowError(expect.objectContaining({ status: 400 }));
    });

    it('podpis policzony innym sekretem → 400 — to objaw restartu `stripe listen`', () => {
      const stale = sign(PAYLOAD, 'whsec_innysekretinnysekretinny');

      expect(() =>
        configured().constructEvent(Buffer.from(PAYLOAD), stale),
      ).toThrowError(expect.objectContaining({ status: 400 }));
    });

    it('podmieniona treść przy prawidłowym podpisie → 400', () => {
      const signature = sign(PAYLOAD);
      const tampered = Buffer.from(PAYLOAD.replace('pi_1', 'pi_cudze'));

      expect(() =>
        configured().constructEvent(tampered, signature),
      ).toThrowError(expect.objectContaining({ status: 400 }));
    });

    it('komunikat błędu nie zdradza szczegółów weryfikacji', () => {
      // sfałszowanemu żądaniu nie podpowiadamy, co dokładnie się nie zgadza
      expect(() =>
        configured().constructEvent(Buffer.from(PAYLOAD), 't=1,v1=deadbeef'),
      ).toThrowError(
        expect.objectContaining({
          message: 'Nieprawidłowy podpis zdarzenia Stripe',
        }),
      );
    });
  });
});
