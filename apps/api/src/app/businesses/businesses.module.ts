import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { BusinessImagesController } from './business-images.controller';
import { BusinessImagesService } from './business-images.service';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  // po ReviewsService.statsFor dla avgRating/reviewCount w profilu i wynikach wyszukiwarki (#47);
  // cyklu nie ma, bo ReviewsModule nie importuje niczego
  imports: [ReviewsModule],
  controllers: [BusinessesController, BusinessImagesController],
  providers: [BusinessesService, BusinessImagesService],
})
export class BusinessesModule {}
