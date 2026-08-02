import { ConfigService } from '@nestjs/config';
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
});
