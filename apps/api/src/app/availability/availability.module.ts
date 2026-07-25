import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController],
  // bez exports: BookingsModule (#25) re-waliduje slot na czystych funkcjach z business-time.ts
  // i slots.util.ts, bo musi liczyć na kliencie transakcji, nie na PrismaService
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
