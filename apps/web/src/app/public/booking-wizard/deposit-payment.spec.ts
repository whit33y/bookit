import { TestBed } from '@angular/core/testing';
import type {
  Stripe,
  StripeElements,
  StripePaymentElement,
} from '@stripe/stripe-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeLoader } from '../../shared/payments/stripe-loader';
import { settle } from '../testing-helpers';
import DepositPayment, {
  formatCountdown,
  secondsUntil,
} from './deposit-payment';

const CLIENT_SECRET = 'pi_1_secret_x';
const RETURN_URL = 'http://localhost/studio/rezerwacja';

type ConfirmResult = Awaited<ReturnType<Stripe['confirmPayment']>>;

/** Atrapa SDK — prawdziwy Stripe.js nie działa w jsdom (iframe + skrypt z js.stripe.com). */
function fakeStripe(confirmPayment: ReturnType<typeof vi.fn>) {
  const mount = vi.fn();
  const elements = {
    create: vi.fn(() => ({ mount }) as unknown as StripePaymentElement),
  } as unknown as StripeElements;

  const stripe = {
    elements: vi.fn(() => elements),
    confirmPayment,
  } as unknown as Stripe;

  return { stripe, elements, mount };
}

async function render(options: {
  confirm?: () => Promise<ConfirmResult>;
  stripe?: Stripe | null;
  expiresAt?: string;
} = {}) {
  const confirmPayment = vi.fn(
    options.confirm ??
      (async () =>
        ({ paymentIntent: { status: 'succeeded' } }) as ConfirmResult),
  );
  const sdk = fakeStripe(confirmPayment);
  const stripe = 'stripe' in options ? options.stripe : sdk.stripe;
  const load = vi.fn().mockResolvedValue(stripe);

  TestBed.configureTestingModule({
    imports: [DepositPayment],
    providers: [{ provide: StripeLoader, useValue: { load } }],
  });

  const fixture = TestBed.createComponent(DepositPayment);
  const paidEvents: number[] = [];
  const unavailableEvents: number[] = [];
  fixture.componentInstance.paid.subscribe(() => paidEvents.push(1));
  fixture.componentInstance.unavailable.subscribe(() =>
    unavailableEvents.push(1),
  );

  fixture.componentRef.setInput('clientSecret', CLIENT_SECRET);
  fixture.componentRef.setInput('amountCents', 5400);
  fixture.componentRef.setInput(
    'expiresAt',
    options.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
  );
  fixture.componentRef.setInput('returnUrl', RETURN_URL);
  fixture.detectChanges();

  // mount() czeka na StripeLoader.load() — bez tego kroku formularza jeszcze nie ma
  await settle(fixture);
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  // Intl wstawia w „54 zł" twardą spację — ta sama normalizacja co w business-profile.spec.ts
  const text = () => (el.textContent ?? '').replace(/\s/g, ' ');
  const payButton = () =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Zapłać'),
    );
  const alerts = () =>
    [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent ?? '');
  const pay = async () => {
    payButton()!.click();
    await settle(fixture);
    fixture.detectChanges();
  };

  return {
    fixture,
    el,
    text,
    payButton,
    alerts,
    pay,
    paidEvents,
    unavailableEvents,
    confirmPayment,
    sdk,
  };
}

describe('secondsUntil', () => {
  const now = Date.parse('2026-08-02T10:00:00.000Z');

  it('liczy pozostałe sekundy w górę do pełnej', () => {
    expect(secondsUntil('2026-08-02T10:02:30.500Z', now)).toBe(151);
  });

  it('termin w przeszłości → 0, nigdy liczba ujemna', () => {
    expect(secondsUntil('2026-08-02T09:59:00.000Z', now)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('formatuje jak zegar, z dopełnieniem sekund', () => {
    expect(formatCountdown(725)).toBe('12:05');
    expect(formatCountdown(59)).toBe('0:59');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('DepositPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pokazuje kwotę zaliczki i montuje Payment Element z otrzymanym sekretem', async () => {
    const ctx = await render();

    expect(ctx.text()).toContain('54 zł');
    expect(ctx.sdk.stripe.elements).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: CLIENT_SECRET }),
    );
    expect(ctx.sdk.elements.create).toHaveBeenCalledWith('payment');
    expect(ctx.sdk.mount).toHaveBeenCalledTimes(1);
  });

  it('udana płatność emituje paid', async () => {
    const ctx = await render();

    await ctx.pay();

    expect(ctx.paidEvents).toHaveLength(1);
    expect(ctx.alerts()).toHaveLength(0);
  });

  // metody z przekierowaniem (BLIK, P24) kończą się `processing`, a nie `succeeded` —
  // dla kreatora to ten sam koniec: rezerwacja nie czeka już na klienta
  it('status processing też kończy krok płatności', async () => {
    const ctx = await render({
      confirm: async () =>
        ({ paymentIntent: { status: 'processing' } }) as ConfirmResult,
    });

    await ctx.pay();

    expect(ctx.paidEvents).toHaveLength(1);
  });

  it('płatność idzie bez przekierowania, z adresem powrotu dla metod, które go wymagają', async () => {
    const ctx = await render();

    await ctx.pay();

    expect(ctx.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect: 'if_required',
        confirmParams: { return_url: RETURN_URL },
      }),
    );
  });

  // AC: „błąd płatności → możliwość ponowienia w oknie ważności rezerwacji"
  it('odrzucona karta pokazuje komunikat Stripe’a i zostawia aktywny przycisk', async () => {
    const ctx = await render({
      confirm: async () =>
        ({
          error: { message: 'Twoja karta została odrzucona.' },
        }) as ConfirmResult,
    });

    await ctx.pay();

    expect(ctx.alerts().join()).toContain('Twoja karta została odrzucona.');
    expect(ctx.paidEvents).toHaveLength(0);
    expect(ctx.payButton()?.disabled).toBe(false);
  });

  it('ponowna próba po błędzie idzie tym samym client_secret i może się udać', async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: 'Odmowa banku.' } })
      .mockResolvedValueOnce({ paymentIntent: { status: 'succeeded' } });
    const ctx = await render({ confirm });

    await ctx.pay();
    await ctx.pay();

    expect(ctx.paidEvents).toHaveLength(1);
    // drugie podejście nie tworzy nowych elements — to ten sam PaymentIntent
    expect(ctx.sdk.stripe.elements).toHaveBeenCalledTimes(1);
  });

  it('wyjątek z SDK nie wywraca kroku — komunikat po polsku i można ponowić', async () => {
    const ctx = await render({
      confirm: async () => {
        throw new Error('network');
      },
    });

    await ctx.pay();

    expect(ctx.alerts().join()).toContain('Nie udało się połączyć z operatorem');
    expect(ctx.payButton()?.disabled).toBe(false);
  });

  it('minione okno płatności → brak przycisku i wyjaśnienie zamiast formularza', async () => {
    const ctx = await render({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(ctx.payButton()).toBeUndefined();
    expect(ctx.alerts().join()).toContain('Czas na opłacenie zaliczki minął');
  });

  it('środowisko bez skonfigurowanego Stripe’a → komunikat zamiast pustego formularza', async () => {
    const ctx = await render({ stripe: null });

    expect(ctx.alerts().join()).toContain(
      'Nie udało się załadować formularza płatności',
    );
    expect(ctx.payButton()).toBeUndefined();
  });

  // client_secret żyje wyłącznie w pamięci tej instancji, więc rada „odśwież stronę"
  // odbierałaby jedyną możliwość zapłaty zamiast ją przywracać
  it('komunikat o braku formularza nie każe odświeżać strony', async () => {
    const ctx = await render({ stripe: null });

    expect(ctx.text()).not.toContain('Odśwież stronę');
    expect(ctx.alerts().join()).toContain('zwolni się po upływie odliczania');
  });

  it('brak formularza zgłasza się rodzicowi, żeby dał wyjście z ekranu', async () => {
    const ctx = await render({ stripe: null });

    expect(ctx.unavailableEvents).toHaveLength(1);
  });

  it('działający formularz nie zgłasza niedostępności', async () => {
    const ctx = await render();

    expect(ctx.unavailableEvents).toHaveLength(0);
  });
});
