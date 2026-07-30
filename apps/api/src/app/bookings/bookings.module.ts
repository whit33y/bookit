import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingEventsService } from './booking-events.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BusinessBookingsController } from './business-bookings.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController, BusinessBookingsController],
  providers: [BookingsService, BookingEventsService],
})
export class BookingsModule {}
