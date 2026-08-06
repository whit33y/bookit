import { Module } from '@nestjs/common';
import { BusinessStatsController } from './stats.controller';
import { StatsService } from './stats.service';

// PrismaModule jest @Global(), więc bez importów
@Module({
  controllers: [BusinessStatsController],
  providers: [StatsService],
})
export class StatsModule {}
