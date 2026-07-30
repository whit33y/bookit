import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import {
  BOOKING_EMAIL_RECIPIENT,
  BookingEmailEvent,
  renderBookingEmail,
} from './templates/booking.template';
import { renderPasswordResetEmail } from './templates/password-reset.template';

// Komplet danych do treści maila jednym zapytaniem — email klienta i właściciela firmy
// (Business nie ma własnego adresu, więc pisze się do ownera) plus wszystko, co pokazuje
// szablon. Zawężony select, bo mail nie potrzebuje ani hashy haseł, ani id relacji.
const bookingEmailSelect = {
  startsAt: true,
  endsAt: true,
  clientNote: true,
  client: { select: { email: true, firstName: true, lastName: true, phone: true } },
  business: {
    select: {
      name: true,
      street: true,
      city: true,
      postalCode: true,
      phone: true,
      owner: { select: { email: true } },
    },
  },
  service: { select: { name: true, durationMin: true, priceCents: true } },
  employee: { select: { name: true } },
} satisfies Prisma.BookingSelect;

/**
 * Powiadomienia mailowe (#37). Jedyny konsument MailService — reszta aplikacji zna wyłącznie
 * ten serwis, więc szablony i adresaci mają jedno miejsce.
 *
 * Kontrakt metod od rezerwacji (bookingCreated / bookingStatusChanged): **nigdy nie odrzucają**.
 * Powiadomienie jest efektem ubocznym zapisanej już operacji, a AC #37 wymaga, żeby błąd
 * wysyłki nie wywalał operacji na rezerwacji — dlatego cała praca (lookup + SMTP) siedzi
 * w try/catch, a wołający może bezpiecznie zrobić `void`. sendPasswordReset zachowuje się
 * odwrotnie i rzuca, bo AuthService.forgotPassword ma własny catch i tam błąd jest jedynym
 * sygnałem (odpowiedź jest zawsze 204, żeby nie zdradzać istnienia konta).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Nowa rezerwacja (PENDING) — informacja dla firmy, że czeka decyzja. */
  bookingCreated(bookingId: string): Promise<void> {
    return this.sendBookingEmail(bookingId, 'CREATED');
  }

  /** Zmiana statusu rezerwacji — mail do klienta albo firmy, zależnie od zdarzenia. */
  bookingStatusChanged(bookingId: string, to: BookingStatus): Promise<void> {
    return this.sendBookingEmail(bookingId, to);
  }

  private async sendBookingEmail(
    bookingId: string,
    event: BookingEmailEvent,
  ): Promise<void> {
    // Odbiorcę rozstrzygamy przed zapytaniem do bazy — zdarzenia bez maila (np. COMPLETED
    // z crona #39) nie mają kosztować dodatkowego SELECT-a.
    const recipient = BOOKING_EMAIL_RECIPIENT[event];
    if (!recipient) {
      return;
    }

    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: bookingEmailSelect,
      });
      if (!booking) {
        this.logger.warn(`Rezerwacja ${bookingId} zniknęła przed wysłaniem powiadomienia`);
        return;
      }

      const message = renderBookingEmail(
        event,
        booking,
        this.config.getOrThrow<string>('APP_URL'),
      );
      if (!message) {
        return;
      }

      const to =
        recipient === 'CLIENT' ? booking.client.email : booking.business.owner.email;
      await this.mail.send({ to, ...message });
      this.logger.log(`Powiadomienie ${event} dla rezerwacji ${bookingId} wysłane`);
    } catch (e) {
      // Bez rzucania dalej: rezerwacja jest już zapisana, a nieudany mail nie może
      // zamienić jej sukcesu w błąd (AC #37).
      this.logger.error(
        `Nie udało się wysłać powiadomienia ${event} dla rezerwacji ${bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
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
