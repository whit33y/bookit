import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  // po ReviewsService.statsFor dla avgRating/reviewCount w profilu i wynikach wyszukiwarki (#47);
  // cyklu nie ma, bo ReviewsModule nie importuje niczego
  imports: [ReviewsModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
