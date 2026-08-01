import { Module } from '@nestjs/common';
import { BookingReviewController } from './booking-review.controller';
import { BusinessReviewsController } from './business-reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [BookingReviewController, BusinessReviewsController],
  providers: [ReviewsService],
  // eksport dla BusinessesModule — profil i wyniki wyszukiwarki doklejają avgRating/reviewCount
  exports: [ReviewsService],
})
export class ReviewsModule {}
