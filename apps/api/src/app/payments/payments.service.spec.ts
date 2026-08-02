import { BookingStatus, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService, UnpaidPayment } from './payments.service';
import { StripeService } from './stripe.service';

const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const BOOKING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const INTENT_ID = 'pi_1';

const unpaid: UnpaidPayment = {
  id: PAYMENT_ID,
  bookingId: BOOKING_ID,
  stripePaymentIntentId: INTENT_ID,
};

// Minimalny PaymentIntent — serwis czyta z niego tylko id, latest_charge i (przy retrieve) status.
const intent = (overrides: Partial<Stripe.PaymentIntent> = {}) =>
  ({
    id: INTENT_ID,
    latest_charge: 'ch_1',
    ...overrides,
  }) as Stripe.PaymentIntent;

const event = (type: string, object: unknown) =>
  ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;

describe('PaymentsService', () => {
  let paymentUpdateMany: ReturnType<typeof vi.fn>;
  let paymentFindUnique: ReturnType<typeof vi.fn>;
  let bookingUpdateMany: ReturnType<typeof vi.fn>;
  let bookingCreated: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let retrieve: ReturnType<typeof vi.fn>;
  let service: PaymentsService;

  beforeEach(() => {
    // pierwsze wywołanie „wygrywa" claim, kolejne trafiają w count 0 — tak jak warunek
    // `status: PENDING` w WHERE zachowa się w bazie przy powtórzonym zdarzeniu
    paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    paymentFindUnique = vi
      .fn()
      .mockResolvedValue({ id: PAYMENT_ID, bookingId: BOOKING_ID });
    bookingUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    bookingCreated = vi.fn().mockResolvedValue(undefined);
    create = vi
      .fn()
      .mockResolvedValue({ id: INTENT_ID, client_secret: 'pi_1_secret' });
    cancel = vi.fn().mockResolvedValue(intent());
    retrieve = vi.fn().mockResolvedValue(intent({ status: 'canceled' }));

    const tx = {
      payment: { updateMany: paymentUpdateMany, findUnique: paymentFindUnique },
      booking: { updateMany: bookingUpdateMany },
    };

    service = new PaymentsService(
      {
        payment: {
          updateMany: paymentUpdateMany,
          findUnique: paymentFindUnique,
        },
        booking: { updateMany: bookingUpdateMany },
        $transaction: (cb: (client: typeof tx) => unknown) => cb(tx),
      } as unknown as PrismaService,
      {
        isConfigured: true,
        client: { paymentIntents: { create, cancel, retrieve } },
      } as unknown as StripeService,
      { bookingCreated } as unknown as NotificationsService,
    );
  });

  describe('createDepositIntent', () => {
    it('kwota, waluta i powiązanie z rezerwacją idą do Stripe', async () => {
      await service.createDepositIntent(unpaid, 6600);

      expect(create.mock.calls[0][0]).toEqual({
        amount: 6600,
        currency: 'pln',
        automatic_payment_methods: { enabled: true },
        metadata: { bookingId: BOOKING_ID, paymentId: PAYMENT_ID },
      });
    });

    it('idempotencyKey to id płatności — retry po timeoucie sieci nie tworzy drugiego intentu', async () => {
      await service.createDepositIntent(unpaid, 6600);

      expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: PAYMENT_ID });
    });

    it('zwraca identyfikator i client_secret', async () => {
      await expect(service.createDepositIntent(unpaid, 6600)).resolves.toEqual({
        paymentIntentId: INTENT_ID,
        clientSecret: 'pi_1_secret',
      });
    });

    it('brak client_secret → 503, bo front nie miałby czym zapłacić', async () => {
      create.mockResolvedValue({ id: INTENT_ID, client_secret: null });

      await expect(
        service.createDepositIntent(unpaid, 6600),
      ).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  // AC #51: „Webhook idempotentny (retry Stripe nie duplikuje zmian)".
  describe('payment_intent.succeeded', () => {
    const succeeded = () =>
      service.handleEvent(event('payment_intent.succeeded', intent()));

    it('płatność przechodzi w SUCCEEDED z paidAt i identyfikatorem obciążenia', async () => {
      await succeeded();

      const call = paymentUpdateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        stripePaymentIntentId: INTENT_ID,
        status: PaymentStatus.PENDING,
      });
      expect(call.data).toMatchObject({
        status: PaymentStatus.SUCCEEDED,
        stripeChargeId: 'ch_1',
      });
      expect(call.data.paidAt).toBeInstanceOf(Date);
    });

    it('status rezerwacji zostaje nietknięty — jest już PENDING od chwili utworzenia', async () => {
      await succeeded();

      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });

    it('mail „nowa rezerwacja" idzie do firmy dopiero teraz', async () => {
      await succeeded();

      expect(bookingCreated).toHaveBeenCalledWith(BOOKING_ID);
    });

    it('powtórzone zdarzenie nie zmienia nic i nie wysyła drugiego maila', async () => {
      // drugie dostarczenie tego samego zdarzenia: warunek `status: PENDING` już nie pasuje
      paymentUpdateMany.mockResolvedValue({ count: 0 });

      await succeeded();

      expect(paymentFindUnique).not.toHaveBeenCalled();
      expect(bookingCreated).not.toHaveBeenCalled();
    });

    it('wyścig z cronem: płatność już CANCELLED → brak maila, bez wyjątku', async () => {
      paymentUpdateMany.mockResolvedValue({ count: 0 });

      await expect(succeeded()).resolves.toBeUndefined();
      expect(bookingCreated).not.toHaveBeenCalled();
    });

    it('rozwinięte latest_charge też daje identyfikator obciążenia', async () => {
      await service.handleEvent(
        event(
          'payment_intent.succeeded',
          intent({ latest_charge: { id: 'ch_2' } as Stripe.Charge }),
        ),
      );

      expect(paymentUpdateMany.mock.calls[0][0].data.stripeChargeId).toBe(
        'ch_2',
      );
    });
  });

  describe('pozostałe zdarzenia', () => {
    it('payment_intent.payment_failed nic nie zmienia — klient może ponowić', async () => {
      await service.handleEvent(
        event('payment_intent.payment_failed', intent()),
      );

      expect(paymentUpdateMany).not.toHaveBeenCalled();
      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });

    it('payment_intent.canceled zwalnia slot', async () => {
      await service.handleEvent(event('payment_intent.canceled', intent()));

      expect(paymentUpdateMany.mock.calls[0][0]).toEqual({
        where: { id: PAYMENT_ID, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });
      expect(bookingUpdateMany.mock.calls[0][0]).toEqual({
        where: { id: BOOKING_ID, status: BookingStatus.PENDING },
        data: { status: BookingStatus.CANCELLED_BY_CLIENT },
      });
    });

    it('canceled dla intentu spoza naszej bazy przechodzi bez błędu', async () => {
      paymentFindUnique.mockResolvedValue(null);

      await expect(
        service.handleEvent(event('payment_intent.canceled', intent())),
      ).resolves.toBeUndefined();
      expect(paymentUpdateMany).not.toHaveBeenCalled();
    });

    it('nieznany typ zdarzenia nie wywala handlera (endpoint ma oddać 200)', async () => {
      await expect(
        service.handleEvent(event('charge.dispute.created', { id: 'dp_1' })),
      ).resolves.toBeUndefined();
    });
  });

  // AC #51: „Nieopłacona rezerwacja wygasa po timeoucie (cron) i zwalnia slot".
  describe('releaseUnpaid', () => {
    it('anuluje PaymentIntent PRZED zapisem w bazie', async () => {
      const order: string[] = [];
      cancel.mockImplementation(() => {
        order.push('stripe');
        return Promise.resolve(intent());
      });
      paymentUpdateMany.mockImplementation(() => {
        order.push('db');
        return Promise.resolve({ count: 1 });
      });

      await service.releaseUnpaid(unpaid);

      // odwrotna kolejność zwolniłaby termin, a klient wciąż mógłby dokończyć płatność
      expect(order).toEqual(['stripe', 'db']);
      expect(cancel).toHaveBeenCalledWith(INTENT_ID, {
        cancellation_reason: 'abandoned',
      });
    });

    it('płatność → CANCELLED, rezerwacja → CANCELLED_BY_CLIENT', async () => {
      await expect(service.releaseUnpaid(unpaid)).resolves.toBe(true);

      expect(paymentUpdateMany.mock.calls[0][0].data).toEqual({
        status: PaymentStatus.CANCELLED,
      });
      expect(bookingUpdateMany.mock.calls[0][0].data).toEqual({
        status: BookingStatus.CANCELLED_BY_CLIENT,
      });
    });

    it('bez maila — firma nigdy nie dowiedziała się o tej rezerwacji', async () => {
      await service.releaseUnpaid(unpaid);

      expect(bookingCreated).not.toHaveBeenCalled();
    });

    it('płatność bez PaymentIntenta zwalnia slot bez kontaktu ze Stripe', async () => {
      await expect(
        service.releaseUnpaid({ ...unpaid, stripePaymentIntentId: null }),
      ).resolves.toBe(true);

      expect(cancel).not.toHaveBeenCalled();
      expect(paymentUpdateMany).toHaveBeenCalled();
    });

    it('płatność przeszła w międzyczasie → slot zostaje przy kliencie', async () => {
      cancel.mockRejectedValue({ code: 'payment_intent_unexpected_state' });
      retrieve.mockResolvedValue(intent({ status: 'succeeded' }));

      await expect(service.releaseUnpaid(unpaid)).resolves.toBe(false);
      expect(paymentUpdateMany).not.toHaveBeenCalled();
    });

    // Przelewy24 i BLIK (automatic_payment_methods dla PLN) przechodzą przez `processing`,
    // zanim się powiodą. Potraktowanie tego stanu jak „nieopłacone" oddałoby termin komuś
    // innemu, a późniejszy payment_intent.succeeded trafiłby już w status CANCELLED
    // i zostałby po cichu zignorowany — klient zapłaciłby za nic.
    it.each(['processing', 'requires_action', 'requires_capture'])(
      'pieniądze w locie (%s) → slot NIE jest zwalniany',
      async (status) => {
        cancel.mockRejectedValue({ code: 'payment_intent_unexpected_state' });
        retrieve.mockResolvedValue(
          intent({ status } as Partial<Stripe.PaymentIntent>),
        );

        await expect(service.releaseUnpaid(unpaid)).resolves.toBe(false);
        expect(paymentUpdateMany).not.toHaveBeenCalled();
        expect(bookingUpdateMany).not.toHaveBeenCalled();
      },
    );

    it('intent już anulowany → zapis dochodzi, żeby rekord nie wisiał w PENDING', async () => {
      cancel.mockRejectedValue({ code: 'payment_intent_unexpected_state' });
      retrieve.mockResolvedValue(intent({ status: 'canceled' }));

      await expect(service.releaseUnpaid(unpaid)).resolves.toBe(true);
      expect(paymentUpdateMany).toHaveBeenCalled();
    });

    it('inny błąd Stripe leci dalej — nie udajemy, że slot zwolniony', async () => {
      cancel.mockRejectedValue({ code: 'api_connection_error' });

      await expect(service.releaseUnpaid(unpaid)).rejects.toMatchObject({
        code: 'api_connection_error',
      });
      expect(paymentUpdateMany).not.toHaveBeenCalled();
    });

    it('powtórne wygaszenie tej samej płatności nie rusza rezerwacji', async () => {
      paymentUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.releaseUnpaid(unpaid)).resolves.toBe(false);
      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });
  });

  it('isEnabled przekazuje rozgałęzienie ze StripeService', () => {
    expect(service.isEnabled).toBe(true);
  });
});
