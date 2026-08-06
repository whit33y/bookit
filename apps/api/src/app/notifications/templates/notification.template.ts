import { BookingStatus, NotificationType } from '@prisma/client';
import { formatDateIso, formatDateTimeRange } from '../format';
import {
  BOOKING_EVENT_RECIPIENT,
  BookingEvent,
  BookingEventData,
} from './booking-event';

/** Wiersz do zapisu w tabeli Notification — bez userId, którego szablon nie zna. */
export interface RenderedNotification {
  type: NotificationType;
  title: string;
  body: string;
  url: string;
}

/**
 * Deep-link „prowadzi do wizyty" (AC #54). Klient ma jeden ekran z wizytami, firma —
 * kalendarz adresowany dobą, więc adres firmy niesie dodatkowo dzień wizyty. Ścieżki
 * odpowiadają trasom z apps/web/src/app/app.routes.ts; ten sam kompromis co w CTA maili,
 * które też znają trasy frontu.
 */
const bookingUrl = (
  recipient: 'CLIENT' | 'BUSINESS',
  bookingId: string,
  startsAt: Date,
): string =>
  recipient === 'CLIENT'
    ? `/client?booking=${bookingId}`
    : `/business/calendar?date=${formatDateIso(startsAt)}&booking=${bookingId}`;

/**
 * Treść powiadomienia in-app dla zdarzenia rezerwacji albo `null`, gdy zdarzenie nie ma
 * adresata (patrz BOOKING_EVENT_RECIPIENT). Czysta funkcja, jak renderBookingEmail —
 * dzięki temu ten sam tekst może wygenerować seed demo, bez ciągnięcia Nesta.
 *
 * Teksty są krótsze niż mailowe: plakietka i lista w dzwoneczku mają jeden nagłówek
 * i jedno zdanie, a tabelka z pełnymi danymi wizyty jest po kliknięciu, na docelowym
 * ekranie — nie w powiadomieniu.
 *
 * Nazwy własne nigdy nie stoją przed czasownikiem: rodzaj gramatyczny nazwy firmy ani imienia
 * klienta nie jest znany („Studio Fryzur potwierdziła"), więc rodzaj niesie rzeczownik przed
 * nią („Firma … potwierdziła") albo zdanie jest bezosobowe. Ta sama zasada co w szablonach maili.
 */
export const renderBookingNotification = (
  event: BookingEvent,
  bookingId: string,
  data: BookingEventData,
): RenderedNotification | null => {
  const recipient = BOOKING_EVENT_RECIPIENT[event];
  if (!recipient) {
    return null;
  }

  const when = formatDateTimeRange(data.startsAt, data.endsAt);
  const clientName = `${data.client.firstName} ${data.client.lastName}`;
  const build = (
    type: NotificationType,
    title: string,
    body: string,
  ): RenderedNotification => ({
    type,
    title,
    body,
    url: bookingUrl(recipient, bookingId, data.startsAt),
  });

  switch (event) {
    case 'CREATED':
      return build(
        NotificationType.BOOKING_CREATED,
        'Nowa rezerwacja czeka na decyzję',
        `${data.service.name} — ${when}. Klient: ${clientName}.`,
      );

    case 'REMINDER':
      return build(
        NotificationType.BOOKING_REMINDER,
        'Przypomnienie o wizycie',
        `${data.service.name} w firmie ${data.business.name} — ${when}.`,
      );

    case BookingStatus.CONFIRMED:
      return build(
        NotificationType.BOOKING_CONFIRMED,
        'Rezerwacja potwierdzona',
        `Firma ${data.business.name} potwierdziła wizytę ${data.service.name} — ${when}.`,
      );

    case BookingStatus.DECLINED:
      return build(
        NotificationType.BOOKING_DECLINED,
        'Rezerwacja odrzucona',
        `Firma ${data.business.name} nie może przyjąć wizyty ${data.service.name} — ${when}. Możesz wybrać inny termin.`,
      );

    case BookingStatus.CANCELLED_BY_BUSINESS:
      return build(
        NotificationType.BOOKING_CANCELLED_BY_BUSINESS,
        'Rezerwacja odwołana przez firmę',
        `Firma ${data.business.name} odwołała wizytę ${data.service.name} — ${when}.`,
      );

    case BookingStatus.CANCELLED_BY_CLIENT:
      return build(
        NotificationType.BOOKING_CANCELLED_BY_CLIENT,
        'Klient odwołał rezerwację',
        `${data.service.name} — ${when}. Klient: ${clientName}. Termin jest znowu wolny.`,
      );

    default:
      // Nieosiągalne: zdarzenia bez adresata odsiewa BOOKING_EVENT_RECIPIENT wyżej.
      // Gałąź zostaje, bo nowy status w enumie ma tu wyjść jako brak powiadomienia,
      // a nie jako wyjątek w tle po zapisanej już operacji na rezerwacji.
      return null;
  }
};
