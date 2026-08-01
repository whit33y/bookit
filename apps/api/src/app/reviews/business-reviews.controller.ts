import { Controller, Get, Param, Query } from '@nestjs/common';
import { BusinessReviewsQueryDto } from './dto/business-reviews-query.dto';
import { ReviewsService } from './reviews.service';

// Publiczny odczyt recenzji firmy — bez guardów (jak GET /businesses/:slug i /categories).
// Pełna ścieżka w @Controller jak w AvailabilityController i pozostałych trasach zagnieżdżonych
// pod businesses; inna głębokość niż businesses/:slug, więc bez kolizji tras.
@Controller('businesses/:slug/reviews')
export class BusinessReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  listForBusiness(@Param('slug') slug: string, @Query() query: BusinessReviewsQueryDto) {
    return this.reviewsService.listForBusiness(slug, query);
  }
}
