import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InAppNotificationsService } from './in-app.service';
import { MailService } from './mail.service';
import { BOOKING_EVENT_RECIPIENT, BookingEvent } from './templates/booking-event';
import { renderBookingEmail } from './templates/booking.template';
import { BusinessApplicationDecision } from './templates/business-application';
import { renderBusinessApplicationEmail } from './templates/business-application.template';
import { renderBusinessApplicationNotification } from './templates/notification.template';
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

// Komplet danych do powiadomienia o decyzji w sprawie zgłoszenia (#143). Adresatem jest
// zawsze zgłaszający, więc `owner` niesie i adres (mail), i id (kanał in-app).
const businessDecisionSelect = {
  name: true,
  rejectionReason: true,
  owner: { select: { id: true, email: true, firstName: true } },
} satisfies Prisma.BusinessSelect;

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

    const booking = await this.load(
      this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: bookingEventSelect,
      }),
      `rezerwacji ${bookingId} dla powiadomienia ${event}`,
    );
    if (!booking) {
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

  /** Kanał mailowy decyzji. Nie rzuca — jak sendBookingEmail. */
  private async sendBusinessDecisionEmail(
    businessId: string,
    decision: BusinessApplicationDecision,
    business: Prisma.BusinessGetPayload<{ select: typeof businessDecisionSelect }>,
  ): Promise<void> {
    try {
      const message = renderBusinessApplicationEmail(
        decision,
        business,
        this.config.getOrThrow<string>('APP_URL'),
      );
      await this.mail.send({ to: business.owner.email, ...message });
      this.logger.log(`Powiadomienie ${decision} dla zgłoszenia ${businessId} wysłane`);
    } catch (e) {
      this.logger.error(
        `Nie udało się wysłać powiadomienia ${decision} dla zgłoszenia ${businessId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Odczyt danych do powiadomienia. Zdarzenie niesie samo id, więc każdy kanał zaczyna od
   * dobrania reszty — i każdy musi przeżyć oba nieszczęścia: błąd bazy i wiersz, którego już
   * nie ma (operacja odwołana albo skasowana, zanim wysyłka doszła do głosu). Oba kończą się
   * tak samo: wpis w logu i `null`, nigdy wyjątek — patrz kontrakt w docblocku klasy.
   */
  private async load<T>(query: Promise<T | null>, subject: string): Promise<T | null> {
    const row = await query.catch((e: unknown) => {
      this.logger.error(
        `Nie udało się pobrać ${subject}`,
        e instanceof Error ? e.stack : String(e),
      );
      return null;
    });
    if (!row) {
      this.logger.warn(`Brak ${subject} — powiadomienie nie powstanie`);
    }
    return row;
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

  /**
   * Decyzja administratora w sprawie zgłoszenia firmy (#143): mail i wpis in-app do
   * zgłaszającego. Ten sam kontrakt co przy rezerwacjach — **nigdy nie odrzuca**, bo decyzja
   * jest już zapisana i zamknięta (akceptacji się nie cofa), a nieudany SMTP nie może zamienić
   * jej sukcesu w błąd. Dlatego wołający robi `void`.
   *
   * Dane czytamy tu, nie w admin/: payload zdarzenia to samo id, jak w BookingEventsService.
   */
  async businessDecision(
    businessId: string,
    decision: BusinessApplicationDecision,
  ): Promise<void> {
    const business = await this.load(
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: businessDecisionSelect,
      }),
      `zgłoszenia ${businessId} dla powiadomienia ${decision}`,
    );
    if (!business) {
      return;
    }

    await this.sendBusinessDecisionEmail(businessId, decision, business);

    // Wpis in-app powstaje niezależnie od maila: decyzji nikt nie powtórzy, więc padnięty
    // SMTP nie może zostawić zgłaszającego bez śladu (jak przy zdarzeniach rezerwacji
    // innych niż REMINDER).
    await this.inApp.create(
      renderBusinessApplicationNotification(decision, business),
      business.owner.id,
      `${decision} dla zgłoszenia ${businessId}`,
    );
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
