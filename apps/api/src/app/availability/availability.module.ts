import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController],
  // bez exports — dodamy je w #25, gdy BookingsModule będzie re-walidować slot w transakcji
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
