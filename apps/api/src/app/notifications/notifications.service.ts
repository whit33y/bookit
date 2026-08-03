import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InAppNotificationsService } from './in-app.service';
import { MailService } from './mail.service';
import { BOOKING_EVENT_RECIPIENT, BookingEvent } from './templates/booking-event';
import { renderBookingEmail } from './templates/booking.template';
import { renderPasswordResetEmail } from './templates/password-reset.template';

// Komplet danych do treści powiadomienia jednym zapytaniem — email klienta i właściciela firmy
// (Business nie ma własnego adresu, więc pisze się do ownera) plus wszystko, co pokazują
// szablony. Zawężony select, bo powiadomienie nie potrzebuje hashy haseł; id klienta
// i właściciela są tu dla kanału in-app (#54), który adresuje powiadomienia po userId.
const bookingEventSelect = {
  startsAt: true,
  endsAt: true,
  clientNote: true,
  client: {
    select: { id: true, email: true, firstName: true, lastName: true, phone: true },
  },
  business: {
    select: {
      name: true,
      slug: true,
      street: true,
      city: true,
      postalCode: true,
      phone: true,
      ownerId: true,
      owner: { select: { email: true } },
    },
  },
  service: { select: { name: true, durationMin: true, priceCents: true } },
  employee: { select: { name: true } },
} satisfies Prisma.BookingSelect;

/**
 * Powiadomienia o zdarzeniach rezerwacji: mail (#37) i wpis in-app (#54). Jedyny konsument
 * MailService i InAppNotificationsService — reszta aplikacji zna wyłącznie ten serwis, więc
 * szablony i adresaci mają jedno miejsce, a dołożenie kanału nie rusza `bookings`.
 *
 * Kontrakt metod od rezerwacji (bookingCreated / bookingStatusChanged / bookingReminder):
 * **nigdy nie odrzucają**. Powiadomienie jest efektem ubocznym zapisanej już operacji,
 * a AC #37 wymaga, żeby błąd wysyłki nie wywalał operacji na rezerwacji — dlatego cała praca
 * (lookup + SMTP) siedzi w try/catch, a wołający może bezpiecznie zrobić `void`.
 * sendPasswordReset zachowuje się odwrotnie i rzuca, bo AuthService.forgotPassword ma własny
 * catch i tam błąd jest jedynym sygnałem (odpowiedź jest zawsze 204, żeby nie zdradzać
 * istnienia konta).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly inApp: InAppNotificationsService,
    private readonly config: ConfigService,
  ) {}

  /** Nowa rezerwacja (PENDING) — informacja dla firmy, że czeka decyzja. */
  async bookingCreated(bookingId: string): Promise<void> {
    await this.dispatchBooking(bookingId, 'CREATED');
  }

  /** Zmiana statusu rezerwacji — do klienta albo firmy, zależnie od zdarzenia. */
  async bookingStatusChanged(bookingId: string, to: BookingStatus): Promise<void> {
    await this.dispatchBooking(bookingId, to);
  }

  /**
   * Przypomnienie ~24 h przed wizytą (#38). Jedyna metoda od rezerwacji, która oddaje wynik:
   * cron zaznacza `reminderSentAt` *przed* wysyłką (żeby dwa ticki nie wysłały duplikatu),
   * więc musi wiedzieć, czy cofnąć znacznik. Nadal nie odrzuca — `false` zamiast wyjątku.
   */
  bookingReminder(bookingId: string): Promise<boolean> {
    return this.dispatchBooking(bookingId, 'REMINDER');
  }

  /**
   * Rozesłanie zdarzenia wszystkimi kanałami. `true` = mail poszedł do SMTP; `false` =
   * zdarzenie bez adresata albo błąd (zalogowany). Wynik dotyczy wyłącznie maila, bo tylko
   * na nim opiera decyzję jedyny wołający, który go czyta (cron przypomnień).
   */
  private async dispatchBooking(
    bookingId: string,
    event: BookingEvent,
  ): Promise<boolean> {
    // Odbiorcę rozstrzygamy przed zapytaniem do bazy — zdarzenia bez powiadomienia
    // (np. COMPLETED z crona #39) nie mają kosztować dodatkowego SELECT-a.
    const recipient = BOOKING_EVENT_RECIPIENT[event];
    if (!recipient) {
      return false;
    }

    const booking = await this.prisma.booking
      .findUnique({ where: { id: bookingId }, select: bookingEventSelect })
      .catch((e: unknown) => {
        this.logger.error(
          `Nie udało się pobrać rezerwacji ${bookingId} dla powiadomienia ${event}`,
          e instanceof Error ? e.stack : String(e),
        );
        return null;
      });
    if (!booking) {
      this.logger.warn(`Rezerwacja ${bookingId} zniknęła przed wysłaniem powiadomienia`);
      return false;
    }

    const emailSent = await this.sendBookingEmail(bookingId, event, recipient, booking);

    // REMINDER to jedyne zdarzenie, które cron ponawia (cofa `reminderSentAt`, gdy mail nie
    // poszedł) — przy padniętym SMTP każdy tick zapisywałby kolejne powiadomienie in-app o tej
    // samej wizycie. Dlatego tu i tylko tu zapis czeka na sukces maila. Pozostałe zdarzenia są
    // fire-and-forget: nikt ich nie powtórzy, więc wpis in-app musi powstać niezależnie od SMTP.
    if (event !== 'REMINDER' || emailSent) {
      const userId =
        recipient === 'CLIENT' ? booking.client.id : booking.business.ownerId;
      await this.inApp.createForBooking(event, bookingId, booking, userId);
    }

    return emailSent;
  }

  /** Sam kanał mailowy. Nie rzuca — patrz kontrakt w docblocku klasy. */
  private async sendBookingEmail(
    bookingId: string,
    event: BookingEvent,
    recipient: 'CLIENT' | 'BUSINESS',
    booking: Prisma.BookingGetPayload<{ select: typeof bookingEventSelect }>,
  ): Promise<boolean> {
    try {
      const message = renderBookingEmail(
        event,
        booking,
        this.config.getOrThrow<string>('APP_URL'),
      );
      if (!message) {
        return false;
      }

      const to =
        recipient === 'CLIENT' ? booking.client.email : booking.business.owner.email;
      await this.mail.send({ to, ...message });
      this.logger.log(`Powiadomienie ${event} dla rezerwacji ${bookingId} wysłane`);
      return true;
    } catch (e) {
      // Bez rzucania dalej: rezerwacja jest już zapisana, a nieudany mail nie może
      // zamienić jej sukcesu w błąd (AC #37).
      this.logger.error(
        `Nie udało się wysłać powiadomienia ${event} dla rezerwacji ${bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
      return false;
    }
  }

  /** Link resetu hasła (#4) — w przeciwieństwie do powiadomień rezerwacji rzuca przy błędzie. */
  async sendPasswordReset(to: string, firstName: string, token: string): Promise<void> {
    const message = renderPasswordResetEmail(
      firstName,
      token,
      this.config.getOrThrow<string>('APP_URL'),
    );
    await this.mail.send({ to, ...message });
  }
}
