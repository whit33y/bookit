import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Stripe } from '@stripe/stripe-js';
import { StripeLoader } from './stripe-loader';

// Prawdziwy `loadStripe` wstrzykuje <script src="js.stripe.com"> i czeka na jego onload —
// w jsdom ta promisa nigdy się nie rozwiązuje, więc podmieniamy cały moduł.
const loadStripe = vi.hoisted(() => vi.fn());
vi.mock('@stripe/stripe-js', () => ({ loadStripe }));

const STRIPE = { id: 'stripe' } as unknown as Stripe;

describe('StripeLoader', () => {
  let http: HttpTestingController;
  let loader: StripeLoader;

  beforeEach(() => {
    loadStripe.mockReset();
    loadStripe.mockResolvedValue(STRIPE);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    loader = TestBed.inject(StripeLoader);
  });

  afterEach(() => http.verify());

  const flushConfig = (publishableKey: string | null) =>
    http.expectOne('/api/payments/config').flush({ publishableKey });

  it('klucz z backendu trafia do loadStripe', async () => {
    const pending = loader.load();
    flushConfig('pk_test_x');

    await expect(pending).resolves.toBe(STRIPE);
    expect(loadStripe).toHaveBeenCalledWith('pk_test_x');
  });

  it('publishableKey null → null bez sięgania po skrypt Stripe’a', async () => {
    const pending = loader.load();
    flushConfig(null);

    await expect(pending).resolves.toBeNull();
    expect(loadStripe).not.toHaveBeenCalled();
  });

  // afterEach(verify) pilnuje, że drugie load() nie wysłało własnego żądania — a więc że
  // do <head> nie trafi drugi <script> Stripe'a
  it('drugie load() nie pyta backendu ponownie', async () => {
    const first = loader.load();
    flushConfig('pk_test_x');
    await first;

    await expect(loader.load()).resolves.toBe(STRIPE);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it('błąd pobrania konfiguracji → null, bez wyjątku u wołającego', async () => {
    const pending = loader.load();
    http
      .expectOne('/api/payments/config')
      .flush('', { status: 503, statusText: 'Service Unavailable' });

    await expect(pending).resolves.toBeNull();
  });

  // nieudanej próby nie zapamiętujemy: chwilowe 503 nie może wyłączyć płatności
  // do końca życia zakładki
  it('po nieudanej próbie kolejne load() pyta jeszcze raz', async () => {
    const failing = loader.load();
    http
      .expectOne('/api/payments/config')
      .flush('', { status: 503, statusText: 'Service Unavailable' });
    await failing;

    const retried = loader.load();
    flushConfig('pk_test_x');

    await expect(retried).resolves.toBe(STRIPE);
  });
});
