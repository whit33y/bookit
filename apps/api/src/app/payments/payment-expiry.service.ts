import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_TIMEOUT_MIN, expiryCutoff } from './payment-window';
import { PaymentsService } from './payments.service';

// Co 5 minut. Pięć pól, nie sześć: wariant sześciopolowy liczy sekundy, więc literówka
// zamieniłaby 288 przebiegów na dobę na 17280. Gęściej niż cron domykania wizyt (*/15),
// bo tu po drugiej stronie czeka klient patrzący na zwolniony termin — przy 15-minutowym
// oknie płatności slot wraca 15–20 minut po rezerwacji. Eksportowana, żeby spec mógł
// pilnować kształtu wyrażenia.
export const PAYMENT_EXPIRY_CRON = '*/5 * * * *';

/**
 * Ile płatności wygaszamy w jednym przebiegu. Bez limitu zaległość po dłuższej awarii Stripe'a
 * (kilkaset rekordów × 1–2 okrągłe wywołania każdy) rozciągnęłaby tick ponad 5-minutowy
 * interwał, a `@nestjs/schedule` nie blokuje nakładających się przebiegów — kolejny tick
 * ruszyłby na tym samym zbiorze i zdublował żądania do Stripe'a. Nadmiar nie ginie: rekordy
 * nadal spełniają warunek i wrócą w następnym przebiegu.
 */
export const PAYMENT_EXPIRY_BATCH = 100;

/**
 * Cron wygaszania nieopłaconych rezerwacji (#51): płatności, które przeleżały w PENDING
 * dłużej niż okno płatności, są anulowane w Stripie, a zajęte przez nie terminy wracają
 * do puli. Bez tego jedna porzucona kasa blokowałaby slot aż do dnia wizyty.
 *
 * Job siedzi w payments, nie w bookings jak BookingCompletionService: punktem wyjścia jest
 * stan płatności, a każdy rekord wymaga wołania Stripe'a — przestawienie statusu rezerwacji
 * jest tu skutkiem, nie tematem.
 */
@Injectable()
export class PaymentExpiryService {
  private readonly logger = new Logger(PaymentExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  @Cron(PAYMENT_EXPIRY_CRON)
  handleCron(): void {
    // @Cron ignoruje zwróconą wartość, więc promisa musi domknąć się tutaj — inaczej
    // padnięty transport loggera byłby unhandledRejection i ubił proces API.
    void this.expireUnpaid().catch(() => undefined);
  }

  /**
   * Wygasza płatności starsze niż okno i zwraca liczbę zwolnionych terminów.
   *
   * Pętla po rekordach, a nie jeden `updateMany` jak w BookingCompletionService: każdy
   * PaymentIntent trzeba anulować w Stripie osobno, a zapis bez tego anulowania byłby
   * właśnie tym wyścigiem, którego unikamy (klient płaci za zwolniony slot). Zapytanie
   * trafia w `@@index([status, createdAt])` na Payment, założony w #50 pod ten job.
   *
   * `now` argumentem (jak w BookingCompletionService): testy sprawdzają granicę bez fake
   * timerów, a cały przebieg pracuje na jednym znaczniku czasu.
   */
  async expireUnpaid(now = new Date()): Promise<number> {
    let expiring;
    try {
      expiring = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: { lt: expiryCutoff(now) },
        },
        // najstarsze najpierw — przy zaległości najdłużej blokowane terminy wracają pierwsze,
        // a kolejność zgadza się z indeksem [status, createdAt]
        orderBy: { createdAt: 'asc' },
        take: PAYMENT_EXPIRY_BATCH,
        select: { id: true, bookingId: true, stripePaymentIntentId: true },
      });
    } catch (e) {
      this.logger.error(
        'Nie udało się pobrać nieopłaconych płatności',
        e instanceof Error ? e.stack : String(e),
      );
      return 0;
    }

    let released = 0;
    for (const payment of expiring) {
      try {
        if (await this.payments.releaseUnpaid(payment)) {
          released += 1;
        }
      } catch (e) {
        // Błąd jednego rekordu nie może zabrać reszty przebiegu — nieudany rekord nadal
        // spełnia warunek i wróci za 5 minut.
        this.logger.error(
          `Nie udało się wygasić płatności ${payment.id}`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    // Puste ticki milczą — przy 288 przebiegach na dobę byłby to sam szum.
    if (released > 0) {
      this.logger.log(
        `Nieopłacone rezerwacje wygaszone po ${PAYMENT_TIMEOUT_MIN} min: ${released}`,
      );
    }
    // Wsad do pełna znaczy, że zostały jeszcze rekordy — bez tego logu ucięcie wyglądałoby
    // jak „wygaszono wszystko", a zaległość rosłaby niezauważona.
    if (expiring.length === PAYMENT_EXPIRY_BATCH) {
      this.logger.warn(
        `Limit ${PAYMENT_EXPIRY_BATCH} płatności na przebieg wyczerpany — reszta w kolejnym ticku`,
      );
    }
    return released;
  }
}
