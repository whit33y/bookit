import { Module } from '@nestjs/common';
import { WorkingHoursController } from './working-hours.controller';
import { WorkingHoursService } from './working-hours.service';

@Module({
  controllers: [WorkingHoursController],
  providers: [WorkingHoursService],
})
export class WorkingHoursModule {}
