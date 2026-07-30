import { Injectable, Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

// Minimalny kształt rezerwacji potrzebny zdarzeniu — podzbiór bookingSelect
// z BookingsService (strukturalnie, bez importu w drugą stronę). Reszta danych do maila
// (email klienta, dane firmy, usługa) dobierana jest po id w NotificationsService.
export interface BookingEventPayload {
  id: string;
  businessId: string;
  startsAt: Date;
}

/**
 * Granica bookings ↔ notifications: BookingsService woła te metody po zatwierdzonym zapisie
 * i nie wie nic o mailach, a notifications nie zna maszyny stanów.
 *
 * Obie metody są synchroniczne i zwracają void — wysyłka idzie w tło (`void`), bo klient
 * czekający na odpowiedź nie ma powodu czekać na SMTP. Bezpieczne, bo metody
 * NotificationsService nigdy nie odrzucają (łapią własne błędy i logują) — AC #37: „błąd
 * wysyłki nie wywala operacji na rezerwacji".
 */
@Injectable()
export class BookingEventsService {
  private readonly logger = new Logger(BookingEventsService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /** Nowa rezerwacja (PENDING) — mail do firmy, że czeka decyzja. */
  created(booking: BookingEventPayload): void {
    this.logger.debug(`Rezerwacja ${booking.id}: utworzona`);
    void this.notifications.bookingCreated(booking.id);
  }

  /**
   * Przejście statusu — mail do klienta albo firmy, zależnie od stanu docelowego.
   * `from` nie wpływa dziś na treść (maszyna stanów nie ma dwóch dróg do tego samego
   * statusu o różnym znaczeniu), ale zostaje w sygnaturze jako pełny opis zdarzenia.
   */
  statusChanged(booking: BookingEventPayload, from: BookingStatus, to: BookingStatus): void {
    this.logger.debug(`Rezerwacja ${booking.id}: ${from} → ${to}`);
    void this.notifications.bookingStatusChanged(booking.id, to);
  }
}
