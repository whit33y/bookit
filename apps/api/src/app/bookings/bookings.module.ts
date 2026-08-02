import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { BookingCompletionService } from './booking-completion.service';
import { BookingEventsService } from './booking-events.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BusinessBookingsController } from './business-bookings.controller';

@Module({
  // PaymentsModule daje PaymentsService — zaliczka przy rezerwacji i unieważnianie
  // nieopłaconej płatności przy odwołaniu (#51). Zależność idzie tylko w tę stronę:
  // payments nie importuje bookings, więc nie ma cyklu.
  imports: [NotificationsModule, PaymentsModule],
  controllers: [BookingsController, BusinessBookingsController],
  // BookingCompletionService nie jest eksportowany — nikt go nie woła, uruchamia go sam @Cron.
  providers: [BookingsService, BookingEventsService, BookingCompletionService],
})
export class BookingsModule {}
