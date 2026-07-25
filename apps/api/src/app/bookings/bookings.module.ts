import { Module } from '@nestjs/common';
import { BookingEventsService } from './booking-events.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingEventsService],
})
export class BookingsModule {}
