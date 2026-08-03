import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQuery, parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { BookingEvent, BookingEventData } from './templates/booking-event';
import { renderBookingNotification } from './templates/notification.template';

// Wszystko, co pokazuje dzwoneczek. `userId` zostaje w środku — klient dostaje wyłącznie
// swoje powiadomienia, więc powtarzanie go w odpowiedzi nic nie wnosi.
const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  url: true,
  readAt: true,
  createdAt: true,
  bookingId: true,
} satisfies Prisma.NotificationSelect;

/** Dzwoneczek pokazuje najświeższe powiadomienia, nie archiwum — stąd niższy default niż 20. */
const DEFAULT_LIMIT = 10;

/**
 * Powiadomienia in-app (#54): drugi kanał obok maila. Zapis idzie z NotificationsService
 * (przy tych samych zdarzeniach rezerwacji), odczyt z NotificationsController.
 *
 * Kontrakt zapisu jest ten sam co w kanale mailowym: `createForBooking` **nigdy nie rzuca**.
 * Powiadomienie jest efektem ubocznym już zapisanej operacji na rezerwacji i nie może
 * zamienić jej sukcesu w błąd. Metody odczytu zachowują się odwrotnie — obsługują żądanie
 * HTTP, więc błąd jest tam jedyną prawdziwą odpowiedzią.
 */
@Injectable()
export class InAppNotificationsService {
  private readonly logger = new Logger(InAppNotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Zapis powiadomienia dla zdarzenia rezerwacji. Brak adresata → nic się nie dzieje. */
  async createForBooking(
    event: BookingEvent,
    bookingId: string,
    data: BookingEventData,
    userId: string,
  ): Promise<void> {
    const rendered = renderBookingNotification(event, bookingId, data);
    if (!rendered) {
      return;
    }

    try {
      await this.prisma.notification.create({
        data: { ...rendered, userId, bookingId },
      });
    } catch (e) {
      // Patrz docblock klasy: nieudany zapis powiadomienia nie unieważnia rezerwacji.
      this.logger.error(
        `Nie udało się zapisać powiadomienia ${event} dla rezerwacji ${bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Strona powiadomień użytkownika wraz z licznikiem nieprzeczytanych. Licznik jedzie razem
   * z listą (jak ratingDistribution w ReviewsService), bo dzwoneczek potrzebuje obu naraz —
   * inaczej otwarcie panelu to dwa żądania i chwila, w której plakietka kłamie.
   */
  async list(userId: string, query: PaginationQuery) {
    const { page, limit, skip } = parsePagination(query, {
      defaultLimit: DEFAULT_LIMIT,
    });

    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        select: notificationSelect,
        // najnowsze najpierw; id jako tiebreaker, bo powiadomienia z jednego zdarzenia
        // (i z seeda) mają identyczny createdAt, a bez deterministycznej kolejności ten sam
        // wiersz wychodzi na dwóch stronach
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, total, page, limit, unread };
  }

  /** Sam licznik — to ten endpoint odpytuje polling, więc nie dotyka listy. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unread };
  }

  /**
   * Oznaczenie jako przeczytane. Idempotentne: drugie kliknięcie w to samo powiadomienie
   * (dwie karty, powrót „wstecz") nie przesuwa `readAt`, tylko oddaje ten zapisany wcześniej.
   * Cudze albo nieistniejące → 404, bez różnicy w komunikacie: odpowiedź nie może zdradzać,
   * że powiadomienie o takim id istnieje u kogoś innego.
   */
  async markRead(userId: string, id: string): Promise<{ id: string; readAt: Date }> {
    const readAt = new Date();
    // updateMany, nie update: warunek na userId musi być częścią zapisu, inaczej między
    // sprawdzeniem właściciela i zapisem jest okno na cudzy wiersz. Znacznik ustalamy
    // po naszej stronie, więc trafienie nie wymaga dodatkowego odczytu.
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt },
    });
    if (count > 0) {
      return { id, readAt };
    }

    // Zero znaczy „nie moje/nie istnieje" ALBO „już przeczytane" — rozstrzyga to dopiero
    // odczyt, bo tylko w drugim przypadku mamy co oddać.
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true, readAt: true },
    });
    if (!existing?.readAt) {
      throw new NotFoundException('Nie znaleziono powiadomienia');
    }
    return { id: existing.id, readAt: existing.readAt };
  }

  /** „Oznacz wszystkie jako przeczytane" — bez tego dzwoneczek zostaje z długiem po kilku dniach. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
