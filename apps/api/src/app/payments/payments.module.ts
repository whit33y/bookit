import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';

@Module({
  providers: [StripeService],
  // eksport dla BookingsModule — PaymentIntent przy rezerwacji i webhook (#51)
  exports: [StripeService],
})
export class PaymentsModule {}
