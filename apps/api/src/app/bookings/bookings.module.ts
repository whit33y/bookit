import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingCompletionService } from './booking-completion.service';
import { BookingEventsService } from './booking-events.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BusinessBookingsController } from './business-bookings.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController, BusinessBookingsController],
  // BookingCompletionService nie jest eksportowany — nikt go nie woła, uruchamia go sam @Cron.
  providers: [BookingsService, BookingEventsService, BookingCompletionService],
})
export class BookingsModule {}
