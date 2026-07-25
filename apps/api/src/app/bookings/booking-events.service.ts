import { Injectable, Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';

// Minimalny kształt rezerwacji potrzebny zdarzeniu — podzbiór bookingSelect
// z BookingsService (strukturalnie, bez importu w drugą stronę). M7 dobierze
// email klienta po id, kiedy będzie budować treść wiadomości.
export interface BookingStatusChangedPayload {
  id: string;
  businessId: string;
  startsAt: Date;
}

/**
 * Punkt zaczepienia dla powiadomień z M7 (#37 — moduł notifications). Dziś tylko log;
 * wysyłka (MailService z ../mail/mail.service.ts) i szablony dochodzą w #37, bez zmian
 * w BookingsService — serwis woła statusChanged() po każdym udanym przejściu.
 *
 * Kontrakt dla #37: metoda jest wołana już po zatwierdzonym zapisie, a jej błąd nie może
 * wywalić operacji na rezerwacji (AC #37: „błąd wysyłki nie wywala operacji — log
 * i kontynuacja"). Wyjątki łapie wołający (BookingsService.transition), więc wysyłka może
 * rzucać swobodnie. Jeśli #37 zrobi tę metodę async, musi sama złapać odrzucenie —
 * zwracany void oznacza, że wołający nie awaituje i floating rejection nie miałby kto obsłużyć.
 */
@Injectable()
export class BookingEventsService {
  private readonly logger = new Logger(BookingEventsService.name);

  statusChanged(
    booking: BookingStatusChangedPayload,
    from: BookingStatus,
    to: BookingStatus,
  ): void {
    // M7 (#37): tutaj wysyłka maila do klienta — CONFIRMED / DECLINED / CANCELLED_BY_BUSINESS
    this.logger.debug(`Rezerwacja ${booking.id}: ${from} → ${to}`);
  }
}
