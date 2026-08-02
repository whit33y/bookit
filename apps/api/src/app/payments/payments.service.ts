import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BookingStatus, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_CURRENCY } from './payment-window';
import { StripeService } from './stripe.service';

/** Płatność w stanie „utworzona, nieopłacona" — tyle, ile potrzeba, żeby zwolnić slot. */
export interface UnpaidPayment {
  id: string;
  bookingId: string;
  stripePaymentIntentId: string | null;
}

/**
 * Stripe zwraca ten kod, gdy PaymentIntenta nie da się przestawić w żądany stan — dla
 * `cancel` znaczy to „już jest succeeded albo canceled". Porównanie po polu `code`, a nie
 * `instanceof Stripe.errors.*`: kształt klas błędów bywa zmieniany między wersjami SDK,
 * a `code` jest częścią publicznego API Stripe'a.
 */
const UNEXPECTED_STATE = 'payment_intent_unexpected_state';

const errorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e
    ? (e as { code?: unknown }).code === undefined
      ? undefined
      : String((e as { code?: unknown }).code)
    : undefined;

/**
 * Zaliczki: tworzenie PaymentIntentów przy rezerwacji, rozliczanie zdarzeń z webhooka
 * i zwalnianie slotu po nieopłaconej rezerwacji (#51). BookingsService woła ten serwis
 * i sam nie dotyka SDK — cała wiedza o Stripie kończy się tutaj i w StripeService.
 *
 * Powiadomienie o nowej rezerwacji idzie wprost przez NotificationsService, a nie przez
 * BookingEventsService jak w bookings: tamten provider mieszka w BookingsModule, który sam
 * importuje PaymentsModule, więc sięgnięcie po niego zrobiłoby cykl modułów.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Czy w tym środowisku da się w ogóle pobrać zaliczkę. Po tym rozgałęzia się BookingsService
   * („usługi bez zaliczki działają po staremu"), dzięki czemu bookings nie musi znać ani
   * StripeService, ani nazw zmiennych środowiskowych.
   */
  get isEnabled(): boolean {
    return this.stripe.isConfigured;
  }

  /**
   * PaymentIntent na zaliczkę. `idempotencyKey` to id wiersza Payment, więc ponowienie po
   * timeoucie sieciowym trafi w ten sam intent zamiast tworzyć drugi i obciążać klienta
   * dwa razy. `metadata` wiąże płatność z rezerwacją po stronie Stripe'a — bez tego
   * dochodzenie, czego dotyczy przelew, kończy się na dashboardzie bez kontekstu.
   */
  async createDepositIntent(payment: UnpaidPayment, amountCents: number) {
    const intent = await this.stripe.client.paymentIntents.create(
      {
        amount: amountCents,
        currency: PAYMENT_CURRENCY,
        automatic_payment_methods: { enabled: true },
        metadata: { bookingId: payment.bookingId, paymentId: payment.id },
      },
      { idempotencyKey: payment.id },
    );

    if (!intent.client_secret) {
      // Nie powinno się zdarzyć, ale bez client_secret front nie ma czym zapłacić —
      // lepiej zwolnić slot teraz niż oddać klientowi rezerwację nie do opłacenia.
      throw new ServiceUnavailableException(
        'Nie udało się rozpocząć płatności — spróbuj ponownie za chwilę',
      );
    }

    return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  /** Router zdarzeń webhooka — jedyne wejście z PaymentsController. */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.settleSucceeded(event.data.object);
        break;
      case 'payment_intent.canceled':
        await this.settleCanceled(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        // Tylko log: po odrzuconej karcie PaymentIntent wraca do `requires_payment_method`,
        // więc klient może spróbować ponownie do końca okna płatności. Zwalnianie slotu tutaj
        // kasowałoby rezerwację po pierwszej literówce w numerze karty; od nieopłaconych
        // rezerwacji jest cron.
        this.logger.log(
          `Płatność nieudana, klient może ponowić: ${event.data.object.id}`,
        );
        break;
      default:
        // Stripe wysyła wszystko, na co zapisany jest endpoint, a lista typów rośnie
        // z wersjami API — nieznane zdarzenie ma dostać 200, nie 500.
        this.logger.debug(`Zdarzenie Stripe bez obsługi: ${event.type}`);
    }
  }

  /**
   * Zaliczka opłacona. Rezerwacja jest już PENDING od chwili utworzenia (slot blokuje się
   * od razu), więc opłacenie nie rusza jej statusu — zmienia się wyłącznie wiersz Payment.
   *
   * Idempotencja stoi na warunkowym `updateMany` ze statusem w WHERE (wzorzec „claim then
   * act" z RemindersService): pierwszy przebieg przestawia PENDING → SUCCEEDED, każdy kolejny
   * — czy to retry Stripe'a, czy zdarzenie odtworzone ręcznie — trafia w `count === 0`
   * i kończy się bez maila i bez drugiego zapisu.
   */
  private async settleSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const bookingId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: {
          stripePaymentIntentId: intent.id,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          stripeChargeId: chargeId(intent),
        },
      });
      if (count === 0) {
        return null;
      }
      const payment = await tx.payment.findUnique({
        where: { stripePaymentIntentId: intent.id },
        select: { bookingId: true },
      });
      return payment?.bookingId ?? null;
    });

    if (!bookingId) {
      this.logger.debug(`Płatność ${intent.id} była już rozliczona — pomijam`);
      return;
    }

    this.logger.log(
      `Zaliczka opłacona, rezerwacja ${bookingId} czeka na decyzję firmy`,
    );
    // Dopiero teraz, nie przy tworzeniu rezerwacji: inaczej każdy porzucony checkout
    // wysyłałby firmie maila o wizycie, która za kwadrans wygaśnie.
    await this.notifications.bookingCreated(bookingId);
  }

  /**
   * PaymentIntent anulowany po stronie Stripe'a (np. z dashboardu albo przez nasz własny
   * `cancel` z releaseUnpaid). Zwalnia slot; sam Stripe'a już nie woła, bo intent jest
   * anulowany z definicji zdarzenia.
   */
  private async settleCanceled(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
      select: { id: true, bookingId: true },
    });
    if (!payment) {
      this.logger.debug(
        `Anulowany intent ${intent.id} nie ma płatności w bazie — pomijam`,
      );
      return;
    }
    await this.releaseInDb(payment.id, payment.bookingId);
  }

  /**
   * Zwalnia slot zajęty przez nieopłaconą rezerwację. Jedna ścieżka dla trzech wołających:
   * crona wygaszania, nieudanego utworzenia PaymentIntenta i odwołania rezerwacji, za którą
   * klient jeszcze nie zapłacił. Zwraca `true`, gdy faktycznie coś zwolniła.
   *
   * Kolejność jest tu regułą bezpieczeństwa, nie stylem: **najpierw anulowanie w Stripie,
   * potem zapis w bazie**. Odwrotnie zwolnilibyśmy termin, a klient wciąż mógłby dokończyć
   * płatność w otwartym formularzu i zapłacić za slot, którego już nie ma.
   */
  async releaseUnpaid(payment: UnpaidPayment): Promise<boolean> {
    if (
      payment.stripePaymentIntentId &&
      !(await this.cancelIntent(payment.stripePaymentIntentId))
    ) {
      return false;
    }
    return this.releaseInDb(payment.id, payment.bookingId);
  }

  /**
   * Anuluje PaymentIntent. `true` znaczy „pieniądze na pewno nie wpłyną, slot można zwolnić".
   *
   * Gdy Stripe odmawia anulowania (`payment_intent_unexpected_state`), dociągamy stan zamiast
   * zgadywać — i zwalniamy **wyłącznie** przy `canceled`. Każdy inny stan to pieniądze w locie:
   * `succeeded` już wpłynęły, a `processing` (Przelewy24, BLIK — przy `automatic_payment_methods`
   * to normalna ścieżka dla PLN) wpłyną za moment. Potraktowanie `processing` jak „nieopłacone"
   * oddałoby termin komuś innemu, a późniejszy `payment_intent.succeeded` trafiłby już
   * w `status: CANCELLED` i zostałby po cichu zignorowany — klient zapłaciłby za nic.
   *
   * Rekord nie zawiśnie przez to na zawsze: `processing` kończy się albo `succeeded`
   * (rozliczy webhook), albo powrotem do stanu, z którego `cancel` przechodzi — a wtedy
   * następny tick crona dokończy sprawę.
   */
  private async cancelIntent(intentId: string): Promise<boolean> {
    try {
      await this.stripe.client.paymentIntents.cancel(intentId, {
        cancellation_reason: 'abandoned',
      });
      return true;
    } catch (e) {
      if (errorCode(e) !== UNEXPECTED_STATE) {
        throw e;
      }
      const intent = await this.stripe.client.paymentIntents.retrieve(intentId);
      if (intent.status === 'canceled') {
        // ktoś ubiegł nas z dashboardu albo poprzedni tick padł już po anulowaniu
        return true;
      }
      this.logger.log(
        `Płatność ${intentId} jest w stanie ${intent.status} — nie zwalniam slotu`,
      );
      return false;
    }
  }

  /**
   * Płatność → CANCELLED, rezerwacja → CANCELLED_BY_CLIENT, oba warunkowo po dotychczasowym
   * statusie. Warunek w WHERE daje atomowość bez advisory locka: Postgres w READ COMMITTED
   * przelicza go po zwolnieniu blokady wiersza, więc dwa równoległe przebiegi nie przestawią
   * tego samego rekordu dwa razy (ten sam argument, co w BookingCompletionService).
   *
   * Bez maila. `CANCELLED_BY_CLIENT` normalnie informuje firmę, że termin się zwolnił, ale
   * o tej rezerwacji firma nigdy się nie dowiedziała — mail „nowa rezerwacja" wychodzi
   * dopiero po opłaceniu — więc powiadomienie dotyczyłoby czegoś, czego adresat nie widział.
   * Że rezerwacja wygasła, a nie została odwołana przez klienta, niesie Payment.status.
   */
  private async releaseInDb(
    paymentId: string,
    bookingId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });
      if (count === 0) {
        return false;
      }
      await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.PENDING },
        data: { status: BookingStatus.CANCELLED_BY_CLIENT },
      });
      return true;
    });
  }
}

/**
 * Id obciążenia potrzebne do refundu (#52). Pole bywa rozwinięte do obiektu albo zostaje
 * samym identyfikatorem, zależnie od `expand` w żądaniu — obsługujemy oba kształty.
 */
const chargeId = (intent: Stripe.PaymentIntent): string | null => {
  if (typeof intent.latest_charge === 'string') {
    return intent.latest_charge;
  }
  return intent.latest_charge?.id ?? null;
};
