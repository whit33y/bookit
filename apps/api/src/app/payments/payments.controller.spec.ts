import { Body, Controller, Post, RawBodyRequest } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

const WEBHOOK_SECRET = 'whsec_testtesttesttesttesttest';
const PAYLOAD = JSON.stringify({
  id: 'evt_1',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_1' } },
});

// Prawdziwy StripeService z atrapą ConfigService — weryfikacja podpisu ma być realna,
// bo to ona jest jedynym uwierzytelnieniem tej trasy.
const stripe = () =>
  new StripeService({
    get: (key: string) =>
      ({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      })[key],
  } as unknown as ConfigService);

const sign = (payload: string) =>
  new Stripe('sk_test_x').webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

const request = (rawBody?: Buffer) => ({ rawBody }) as RawBodyRequest<Request>;

describe('PaymentsController', () => {
  let handleEvent: ReturnType<typeof vi.fn>;
  let controller: PaymentsController;

  beforeEach(() => {
    handleEvent = vi.fn().mockResolvedValue(undefined);
    controller = new PaymentsController(stripe(), {
      handleEvent,
    } as unknown as PaymentsService);
  });

  it('poprawnie podpisane zdarzenie trafia do serwisu', async () => {
    const body = Buffer.from(PAYLOAD);

    await expect(
      controller.webhook(request(body), sign(PAYLOAD)),
    ).resolves.toEqual({
      received: true,
    });
    expect(handleEvent.mock.calls[0][0]).toMatchObject({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
    });
  });

  it('brak nagłówka stripe-signature → 400, zdarzenie nie dochodzi do serwisu', async () => {
    await expect(
      controller.webhook(request(Buffer.from(PAYLOAD)), undefined),
    ).rejects.toMatchObject({ status: 400 });
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('sfałszowany podpis → 400', async () => {
    await expect(
      controller.webhook(request(Buffer.from(PAYLOAD)), 't=1,v1=deadbeef'),
    ).rejects.toMatchObject({ status: 400 });
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('handler nie bierze @Body() — inaczej globalny ValidationPipe zjadłby payload', () => {
    // Globalny ValidationPipe z main.ts ma `forbidNonWhitelisted: true`, więc dopięcie DTO
    // do tej trasy odrzucałoby każde zdarzenie Stripe'a błędem 400 — payload ma dziesiątki
    // pól spoza jakiegokolwiek DTO. Asercja idzie po metadanych trasy, a nie po zachowaniu
    // pipe'a w oderwaniu od kontrolera: tylko wtedy test padnie dokładnie w chwili, gdy ktoś
    // doda @Body() do handlera.
    //
    // Prefiks klucza dla @Body() bierzemy z klasy-sondy zamiast wpisywać go na sztywno —
    // to numer z wewnętrznego enuma Nesta, który może się zmienić między wersjami.
    @Controller('probe')
    class BodyProbe {
      @Post()
      handler(@Body() body: unknown) {
        return body;
      }
    }

    const paramPrefixes = (target: object, method: string): string[] =>
      Object.keys(
        Reflect.getMetadata(ROUTE_ARGS_METADATA, target, method) ?? {},
      ).map((key) => key.split(':')[0]);

    const bodyPrefix = paramPrefixes(BodyProbe, 'handler')[0];
    const webhookPrefixes = paramPrefixes(PaymentsController, 'webhook');

    // sonda i metadane są czytelne — inaczej asercja niżej przechodziłaby na pustym zbiorze
    expect(bodyPrefix).toBeDefined();
    expect(webhookPrefixes.length).toBeGreaterThan(0);

    expect(webhookPrefixes).not.toContain(bodyPrefix);
  });
});
