import { Module } from '@nestjs/common';
import { BookingEventsService } from './booking-events.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BusinessBookingsController } from './business-bookings.controller';

@Module({
  controllers: [BookingsController, BusinessBookingsController],
  providers: [BookingsService, BookingEventsService],
})
export class BookingsModule {}
