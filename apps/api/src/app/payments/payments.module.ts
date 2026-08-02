import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentExpiryService } from './payment-expiry.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

@Module({
  // NotificationsModule, bo mail „nowa rezerwacja" wychodzi dopiero po opłaceniu zaliczki (#51).
  // Wprost przez NotificationsService, a nie przez BookingEventsService: ten mieszka
  // w BookingsModule, który importuje ten moduł — sięgnięcie po niego zrobiłoby cykl.
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  // PaymentExpiryService nieeksportowany — nikt go nie woła, uruchamia go sam @Cron.
  providers: [StripeService, PaymentsService, PaymentExpiryService],
  // eksport dla BookingsModule — PaymentIntent przy rezerwacji i zwalnianie slotu (#51)
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
