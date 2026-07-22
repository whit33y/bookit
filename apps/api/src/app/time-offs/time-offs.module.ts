import { Module } from '@nestjs/common';
import { TimeOffsController } from './time-offs.controller';
import { TimeOffsService } from './time-offs.service';

@Module({
  controllers: [TimeOffsController],
  providers: [TimeOffsService],
})
export class TimeOffsModule {}
