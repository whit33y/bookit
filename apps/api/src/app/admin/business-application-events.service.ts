import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Granica admin ↔ notifications, wzorem BookingEventsService: AdminService woła te metody
 * **po** zamkniętej transakcji decyzji i nie wie nic o mailach, a notifications nie zna
 * kolejki zgłoszeń.
 *
 * Poza transakcją i bez `await` — decyzja jest już zapisana, a administrator klikający
 * „Akceptuj" nie ma powodu czekać na SMTP. Bezpieczne, bo `businessDecision` nigdy nie
 * odrzuca (łapie własne błędy i loguje).
 *
 * Zdarzeniu wystarczy identyfikator: komplet danych do treści dobiera po nim
 * NotificationsService, więc payload nie powiela selecta admina.
 */
@Injectable()
export class BusinessApplicationEventsService {
  private readonly logger = new Logger(BusinessApplicationEventsService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /** Zgłoszenie zaakceptowane — właściciel jest już OWNER-em i ma panel firmy. */
  approved(businessId: string): void {
    this.logger.debug(`Zgłoszenie ${businessId}: zaakceptowane`);
    void this.notifications.businessDecision(businessId, 'APPROVED');
  }

  /** Zgłoszenie odrzucone — powód jest już zapisany na wierszu i idzie do maila. */
  rejected(businessId: string): void {
    this.logger.debug(`Zgłoszenie ${businessId}: odrzucone`);
    void this.notifications.businessDecision(businessId, 'REJECTED');
  }
}
